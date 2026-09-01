import type { UserRole, UserSummary } from "@shanyu/contracts";

export const USERS_REPOSITORY = Symbol("USERS_REPOSITORY");

export interface NewUser {
  readonly account: string;
  readonly displayName: string;
  readonly id: string;
  readonly passwordHash: string;
  readonly phone: string | null;
  readonly role: UserRole;
}

export interface UpdatedUser {
  readonly account: string;
  readonly displayName: string;
  readonly id: string;
  readonly role: UserRole;
}

export interface UsersRepository {
  list(): Promise<UserSummary[]>;
  findById(userId: string): Promise<UserSummary | null>;
  create(input: NewUser): Promise<UserSummary>;
  update(input: UpdatedUser): Promise<UserSummary>;
  resetPassword(userId: string, passwordHash: string): Promise<void>;
  disable(userId: string): Promise<UserSummary>;
}

export class DuplicateUserError extends Error {}
export class LastActiveAdministratorError extends Error {}
export class UserNotFoundError extends Error {}
