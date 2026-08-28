import {
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type {
  CreateUserRequest,
  SessionUser,
  UserSummary,
} from "@shanyu/contracts";
import { randomUUID } from "node:crypto";

import { AccessPolicy } from "./access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "./audit.repository";
import { hashPassword } from "./password";
import {
  DuplicateUserError,
  USERS_REPOSITORY,
  type UsersRepository,
} from "./users.repository";

@Injectable()
export class UsersService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
  ) {}

  async list(actor: SessionUser): Promise<UserSummary[]> {
    this.accessPolicy.assertCanManageUsers(actor);
    return this.usersRepository.list();
  }

  async create(
    actor: SessionUser,
    input: CreateUserRequest,
  ): Promise<UserSummary> {
    this.accessPolicy.assertCanManageUsers(actor);
    const id = randomUUID();
    let user: UserSummary;
    try {
      user = await this.usersRepository.create({
        ...input,
        id,
        passwordHash: await hashPassword(input.password),
      });
    } catch (error) {
      if (error instanceof DuplicateUserError) {
        throw new ConflictException("账号或手机号已存在");
      }
      throw error;
    }

    await this.auditRepository.append({
      action: "USER_CREATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: user.id,
      targetType: "USER",
    });
    return user;
  }
}
