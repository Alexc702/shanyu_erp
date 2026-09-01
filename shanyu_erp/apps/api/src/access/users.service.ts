import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateUserRequest,
  ResetUserPasswordRequest,
  SessionUser,
  UpdateUserRequest,
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
  LastActiveAdministratorError,
  USERS_REPOSITORY,
  UserNotFoundError,
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
    const users = await this.usersRepository.list();
    return actor.role === "ADMIN"
      ? users
      : users.filter((user) => user.role !== "ADMIN");
  }

  async create(
    actor: SessionUser,
    input: CreateUserRequest,
  ): Promise<UserSummary> {
    this.accessPolicy.assertCanManageUsers(actor);
    this.assertCanAssignRole(actor, input.role);
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
      afterState: auditState(user),
    });
    return user;
  }

  async update(
    actor: SessionUser,
    userId: string,
    input: UpdateUserRequest,
  ): Promise<UserSummary> {
    const target = await this.findManageableTarget(actor, userId);
    this.assertCanAssignRole(actor, input.role);
    this.assertActive(target);
    let user: UserSummary;
    try {
      user = await this.usersRepository.update({ ...input, id: userId });
    } catch (error) {
      this.handleMutationError(error);
    }
    await this.auditRepository.append({
      action: "USER_UPDATED",
      actorUserId: actor.id,
      beforeState: auditState(target),
      afterState: auditState(user!),
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: userId,
      targetType: "USER",
    });
    return user!;
  }

  async resetPassword(
    actor: SessionUser,
    userId: string,
    input: ResetUserPasswordRequest,
  ): Promise<void> {
    const target = await this.findManageableTarget(actor, userId);
    this.assertActive(target);
    try {
      await this.usersRepository.resetPassword(
        userId,
        await hashPassword(input.password),
      );
    } catch (error) {
      this.handleMutationError(error);
    }
    await this.auditRepository.append({
      action: "USER_PASSWORD_RESET",
      actorUserId: actor.id,
      afterState: { passwordReset: true },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: userId,
      targetType: "USER",
    });
  }

  async remove(actor: SessionUser, userId: string): Promise<UserSummary> {
    const target = await this.findManageableTarget(actor, userId);
    this.assertActive(target);
    let user: UserSummary;
    try {
      user = await this.usersRepository.disable(userId);
    } catch (error) {
      this.handleMutationError(error);
    }
    await this.auditRepository.append({
      action: "USER_DELETED",
      actorUserId: actor.id,
      beforeState: auditState(target),
      afterState: auditState(user!),
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: userId,
      targetType: "USER",
    });
    return user!;
  }

  private async findManageableTarget(
    actor: SessionUser,
    userId: string,
  ): Promise<UserSummary> {
    this.accessPolicy.assertCanManageUsers(actor);
    const target = await this.usersRepository.findById(userId);
    if (!target || (actor.role === "OWNER" && target.role === "ADMIN")) {
      throw new NotFoundException("账号不存在");
    }
    if (actor.role === "OWNER" && actor.id === target.id) {
      throw new ForbiddenException("老板不能管理本人账号");
    }
    return target;
  }

  private assertCanAssignRole(
    actor: SessionUser,
    role: UpdateUserRequest["role"],
  ): void {
    if (actor.role === "ADMIN") {
      return;
    }
    if (
      role !== "OWNER" &&
      role !== "LEAD_DESIGNER" &&
      role !== "WOODWORK_DESIGNER"
    ) {
      throw new ForbiddenException("老板只能设置老板、主案设计师或木作设计师角色");
    }
  }

  private assertActive(user: UserSummary): void {
    if (user.status !== "ACTIVE") {
      throw new ConflictException("账号已删除，不能继续操作");
    }
  }

  private handleMutationError(error: unknown): never {
    if (error instanceof DuplicateUserError) {
      throw new ConflictException("账号或手机号已存在");
    }
    if (error instanceof LastActiveAdministratorError) {
      throw new ConflictException("系统必须保留至少一个可用管理员账号");
    }
    if (error instanceof UserNotFoundError) {
      throw new NotFoundException("账号不存在");
    }
    throw error;
  }
}

function auditState(user: UserSummary): Readonly<Record<string, unknown>> {
  return {
    account: user.account,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}
