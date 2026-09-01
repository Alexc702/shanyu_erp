import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type {
  AuditEventListResponse,
  CreateUserRequest,
  ResetUserPasswordRequest,
  UpdateUserRequest,
  UserRole,
  UserSummary,
} from "@shanyu/contracts";

import { AuditQueryService } from "./audit-query.service";
import { AuthService } from "./auth.service";
import { readSessionToken } from "./session-cookie";
import { UsersService } from "./users.service";

const userRoles = new Set<UserRole>([
  "ADMIN",
  "OWNER",
  "LEAD_DESIGNER",
  "WOODWORK_DESIGNER",
  "PROJECT_MANAGER",
  "FINANCE",
]);

@Controller("users")
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditQueryService: AuditQueryService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async list(
    @Headers("cookie") cookieHeader?: string,
  ): Promise<{ users: UserSummary[] }> {
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return { users: await this.usersService.list(actor) };
  }

  @Get("audit-events")
  async listAuditEvents(
    @Headers("cookie") cookieHeader?: string,
  ): Promise<AuditEventListResponse> {
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return {
      events: await this.auditQueryService.listUserManagement(actor),
    };
  }

  @Post()
  async create(
    @Headers("cookie") cookieHeader: string | undefined,
    @Body() body: Partial<CreateUserRequest>,
  ): Promise<{ user: UserSummary }> {
    const input = validateCreateUser(body);
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return { user: await this.usersService.create(actor, input) };
  }

  @Patch(":userId")
  async update(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("userId") userId: string,
    @Body() body: Partial<UpdateUserRequest>,
  ): Promise<{ user: UserSummary }> {
    const input = validateUpdateUser(body);
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return { user: await this.usersService.update(actor, userId, input) };
  }

  @Put(":userId/password")
  async resetPassword(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("userId") userId: string,
    @Body() body: Partial<ResetUserPasswordRequest>,
  ): Promise<{ success: true }> {
    const input = validateResetPassword(body);
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    await this.usersService.resetPassword(actor, userId, input);
    return { success: true };
  }

  @Delete(":userId")
  async remove(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("userId") userId: string,
  ): Promise<{ user: UserSummary }> {
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return { user: await this.usersService.remove(actor, userId) };
  }
}

function validateCreateUser(body: Partial<CreateUserRequest>): CreateUserRequest {
  const phone = body.phone === null ? null : body.phone?.trim();
  if (
    typeof body.account !== "string" ||
    !/^[A-Za-z0-9._-]{3,64}$/.test(body.account) ||
    typeof body.displayName !== "string" ||
    body.displayName.trim().length < 1 ||
    body.displayName.trim().length > 100 ||
    typeof body.password !== "string" ||
    !isValidPassword(body.password) ||
    typeof body.role !== "string" ||
    !userRoles.has(body.role as UserRole) ||
    (phone !== null && (!phone || phone.length > 32))
  ) {
    throw new BadRequestException("用户信息格式不正确");
  }

  return {
    account: body.account,
    displayName: body.displayName.trim(),
    password: body.password,
    phone,
    role: body.role as UserRole,
  };
}

function validateUpdateUser(body: Partial<UpdateUserRequest>): UpdateUserRequest {
  if (
    typeof body.account !== "string" ||
    !/^[A-Za-z0-9._-]{3,64}$/.test(body.account) ||
    typeof body.displayName !== "string" ||
    body.displayName.trim().length < 1 ||
    body.displayName.trim().length > 100 ||
    typeof body.role !== "string" ||
    !userRoles.has(body.role as UserRole)
  ) {
    throw new BadRequestException("用户信息格式不正确");
  }
  return {
    account: body.account,
    displayName: body.displayName.trim(),
    role: body.role as UserRole,
  };
}

function validateResetPassword(
  body: Partial<ResetUserPasswordRequest>,
): ResetUserPasswordRequest {
  if (typeof body.password !== "string" || !isValidPassword(body.password)) {
    throw new BadRequestException("密码至少 8 位，且必须包含数字与字母");
  }
  return { password: body.password };
}

function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
