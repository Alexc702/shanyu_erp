import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from "@nestjs/common";
import type {
  CreateUserRequest,
  UserRole,
  UserSummary,
} from "@shanyu/contracts";

import { AuthService } from "./auth.service";
import { readSessionToken } from "./session-cookie";
import { UsersService } from "./users.service";

const userRoles = new Set<UserRole>([
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
    body.password.length < 8 ||
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
