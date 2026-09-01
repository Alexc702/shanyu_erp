import { Injectable } from "@nestjs/common";
import type { UserRole, UserStatus, UserSummary } from "@shanyu/contracts";

import {
  DatabaseClient,
  type DatabaseExecutor,
} from "../database/database.client";
import {
  DuplicateUserError,
  LastActiveAdministratorError,
  type NewUser,
  type UpdatedUser,
  UserNotFoundError,
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

  async findById(userId: string): Promise<UserSummary | null> {
    const result = await this.database.query<UserSummaryRow>(
      `SELECT id, account, display_name, phone, role, status
         FROM users
        WHERE id = $1`,
      [userId],
    );
    return result.rows[0] ? toUserSummary(result.rows[0]) : null;
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

  async update(input: UpdatedUser): Promise<UserSummary> {
    try {
      return await this.database.transaction(async (database) => {
        await lockUserManagement(database);
        const current = await database.query<Pick<UserSummaryRow, "role" | "status">>(
          `SELECT role, status FROM users WHERE id = $1 FOR UPDATE`,
          [input.id],
        );
        const existing = current.rows[0];
        if (!existing) throw new UserNotFoundError();
        if (
          existing.role === "ADMIN" &&
          existing.status === "ACTIVE" &&
          input.role !== "ADMIN"
        ) {
          await assertAnotherActiveAdministrator(database, input.id);
        }
        const result = await database.query<UserSummaryRow>(
          `UPDATE users
              SET account = $2,
                  display_name = $3,
                  role = $4,
                  updated_at = current_timestamp
            WHERE id = $1
            RETURNING id, account, display_name, phone, role, status`,
          [input.id, input.account, input.displayName, input.role],
        );
        const row = result.rows[0];
        if (!row) throw new UserNotFoundError();
        return toUserSummary(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateUserError();
      throw error;
    }
  }

  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    await this.database.transaction(async (database) => {
      const result = await database.query(
        `UPDATE user_credentials
            SET password_hash = $2,
                changed_at = current_timestamp
          WHERE user_id = $1
          RETURNING user_id`,
        [userId, passwordHash],
      );
      if (!result.rows[0]) throw new UserNotFoundError();
      await database.query(
        `UPDATE auth_sessions
            SET revoked_at = current_timestamp
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    });
  }

  async disable(userId: string): Promise<UserSummary> {
    return this.database.transaction(async (database) => {
      await lockUserManagement(database);
      const current = await database.query<UserSummaryRow>(
        `SELECT id, account, display_name, phone, role, status
           FROM users
          WHERE id = $1
          FOR UPDATE`,
        [userId],
      );
      const existing = current.rows[0];
      if (!existing) throw new UserNotFoundError();
      if (existing.role === "ADMIN" && existing.status === "ACTIVE") {
        await assertAnotherActiveAdministrator(database, userId);
      }
      const result = await database.query<UserSummaryRow>(
        `UPDATE users
            SET status = 'DISABLED',
                updated_at = current_timestamp
          WHERE id = $1
          RETURNING id, account, display_name, phone, role, status`,
        [userId],
      );
      await database.query(
        `UPDATE auth_sessions
            SET revoked_at = current_timestamp
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) throw new UserNotFoundError();
      return toUserSummary(row);
    });
  }
}

async function lockUserManagement(database: DatabaseExecutor): Promise<void> {
  await database.query("SELECT pg_advisory_xact_lock(73102026)");
}

async function assertAnotherActiveAdministrator(
  database: DatabaseExecutor,
  excludedUserId: string,
): Promise<void> {
  const result = await database.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM users
        WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1
     ) AS exists`,
    [excludedUserId],
  );
  if (!result.rows[0]?.exists) throw new LastActiveAdministratorError();
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
