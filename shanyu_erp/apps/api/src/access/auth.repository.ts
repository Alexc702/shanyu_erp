import type { UserRole } from "@shanyu/contracts";

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export interface StoredUser {
  readonly id: string;
  readonly account: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly status: "ACTIVE" | "DISABLED";
}

export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthRepository {
  findUserByIdentifier(identifier: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  createSession(session: StoredSession): Promise<void>;
  findActiveSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}
