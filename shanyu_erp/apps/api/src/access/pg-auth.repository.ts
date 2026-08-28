import { Injectable } from "@nestjs/common";
import type { UserRole } from "@shanyu/contracts";

import { DatabaseClient } from "../database/database.client";
import type {
  AuthRepository,
  StoredSession,
  StoredUser,
} from "./auth.repository";

interface UserRow {
  account: string;
  display_name: string;
  id: string;
  password_hash: string;
  phone: string | null;
  role: UserRole;
  status: "ACTIVE" | "DISABLED";
}

interface SessionRow {
  created_at: Date;
  expires_at: Date;
  id: string;
  revoked_at: Date | null;
  token_hash: string;
  user_id: string;
}

@Injectable()
export class PgAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findUserByIdentifier(identifier: string): Promise<StoredUser | null> {
    const result = await this.database.query<UserRow>(
      `SELECT u.id, u.account, u.display_name, u.phone, u.role, u.status,
              c.password_hash
         FROM users u
         JOIN user_credentials c ON c.user_id = u.id
        WHERE lower(u.account) = lower($1) OR u.phone = $1
        LIMIT 1`,
      [identifier],
    );
    return result.rows[0] ? toStoredUser(result.rows[0]) : null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const result = await this.database.query<UserRow>(
      `SELECT u.id, u.account, u.display_name, u.phone, u.role, u.status,
              c.password_hash
         FROM users u
         JOIN user_credentials c ON c.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    return result.rows[0] ? toStoredUser(result.rows[0]) : null;
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sessions
         (id, user_id, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        session.revokedAt,
      ],
    );
  }

  async findActiveSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
         FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          id: row.id,
          revokedAt: row.revoked_at,
          tokenHash: row.token_hash,
          userId: row.user_id,
        }
      : null;
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE auth_sessions
          SET revoked_at = $2
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, revokedAt],
    );
  }
}

function toStoredUser(row: UserRow): StoredUser {
  return {
    account: row.account,
    displayName: row.display_name,
    id: row.id,
    passwordHash: row.password_hash,
    phone: row.phone,
    role: row.role,
    status: row.status,
  };
}
