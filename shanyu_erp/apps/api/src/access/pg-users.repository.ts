import { Injectable } from "@nestjs/common";
import type { UserRole, UserStatus, UserSummary } from "@shanyu/contracts";

import { DatabaseClient } from "../database/database.client";
import {
  DuplicateUserError,
  type NewUser,
  type UsersRepository,
} from "./users.repository";

interface UserSummaryRow {
  account: string;
  display_name: string;
  id: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
}

@Injectable()
export class PgUsersRepository implements UsersRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(): Promise<UserSummary[]> {
    const result = await this.database.query<UserSummaryRow>(
      `SELECT id, account, display_name, phone, role, status
         FROM users
        ORDER BY created_at, account`,
    );
    return result.rows.map(toUserSummary);
  }

  async create(input: NewUser): Promise<UserSummary> {
    try {
      const result = await this.database.query<UserSummaryRow>(
        `WITH created_user AS (
           INSERT INTO users (id, account, display_name, phone, role, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
           RETURNING id, account, display_name, phone, role, status
         ), created_credential AS (
           INSERT INTO user_credentials (user_id, password_hash)
           SELECT id, $6 FROM created_user
         )
         SELECT id, account, display_name, phone, role, status
           FROM created_user`,
        [
          input.id,
          input.account,
          input.displayName,
          input.phone,
          input.role,
          input.passwordHash,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("创建用户未返回结果");
      }
      return toUserSummary(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateUserError();
      }
      throw error;
    }
  }
}

function toUserSummary(row: UserSummaryRow): UserSummary {
  return {
    account: row.account,
    displayName: row.display_name,
    id: row.id,
    phone: row.phone,
    role: row.role,
    status: row.status,
  };
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
