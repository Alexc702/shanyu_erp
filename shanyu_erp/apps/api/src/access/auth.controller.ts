import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
} from "@nestjs/common";
import type { LoginRequest, LoginResponse } from "@shanyu/contracts";

import { AuthService } from "./auth.service";
import {
  isSessionCookieSecure,
  readSessionToken,
  sessionCookieName,
} from "./session-cookie";

interface CookieResponse {
  clearCookie(name: string, options: SessionCookieOptions): void;
  cookie(name: string, value: string, options: SessionCookieOptions): void;
}

interface SessionCookieOptions {
  expires?: Date;
  httpOnly: boolean;
  path: string;
  sameSite: "lax";
  secure: boolean;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: Partial<LoginRequest>,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LoginResponse> {
    if (
      typeof body.identifier !== "string" ||
      typeof body.password !== "string" ||
      typeof body.rememberMe !== "boolean"
    ) {
      throw new BadRequestException("登录信息不完整");
    }

    const login = await this.authService.login(
      body.identifier.trim(),
      body.password,
      body.rememberMe,
    );
    response.cookie(sessionCookieName, login.token, {
      expires: login.expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isSessionCookieSecure(),
    });

    return { user: login.user };
  }

  @Get("session")
  async session(
    @Headers("cookie") cookieHeader?: string,
  ): Promise<LoginResponse> {
    const token = readSessionToken(cookieHeader);
    return { user: await this.authService.getSessionUser(token) };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.authService.logout(readSessionToken(cookieHeader));
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isSessionCookieSecure(),
    });
  }
}
