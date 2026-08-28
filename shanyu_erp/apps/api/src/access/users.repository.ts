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

export interface UsersRepository {
  list(): Promise<UserSummary[]>;
  create(input: NewUser): Promise<UserSummary>;
}

export class DuplicateUserError extends Error {}
