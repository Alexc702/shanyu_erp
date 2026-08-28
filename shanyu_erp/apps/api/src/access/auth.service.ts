import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "./audit.repository";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type StoredUser,
} from "./auth.repository";
import { verifyPassword } from "./password";

const twelveHoursMs = 12 * 60 * 60 * 1000;
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

export interface CreatedLogin {
  readonly expiresAt: Date;
  readonly token: string;
  readonly user: SessionUser;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: AuthRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
  ) {}

  async login(
    identifier: string,
    password: string,
    rememberMe: boolean,
  ): Promise<CreatedLogin> {
    const user = await this.authRepository.findUserByIdentifier(identifier);
    const passwordMatches = user
      ? await verifyPassword(password, user.passwordHash)
      : false;

    if (!user || user.status !== "ACTIVE" || !passwordMatches) {
      await this.auditRepository.append({
        action: "AUTH_LOGIN",
        actorUserId: user?.id ?? null,
        occurredAt: new Date(),
        result: "FAILURE",
        targetId: user?.id ?? null,
        targetType: "USER",
      });
      throw new UnauthorizedException("账号或密码错误");
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (rememberMe ? thirtyDaysMs : twelveHoursMs),
    );
    const token = randomBytes(32).toString("base64url");

    await this.authRepository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt,
      revokedAt: null,
    });
    await this.auditRepository.append({
      action: "AUTH_LOGIN",
      actorUserId: user.id,
      occurredAt: now,
      result: "SUCCESS",
      targetId: user.id,
      targetType: "USER",
    });

    return { expiresAt, token, user: toSessionUser(user) };
  }

  async getSessionUser(token: string): Promise<SessionUser> {
    const session = await this.authRepository.findActiveSessionByTokenHash(
      hashSessionToken(token),
    );
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("登录状态已失效");
    }

    const user = await this.authRepository.findUserById(session.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    return toSessionUser(user);
  }

  async logout(token: string): Promise<void> {
    const tokenHash = hashSessionToken(token);
    const session = await this.authRepository.findActiveSessionByTokenHash(
      tokenHash,
    );
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("登录状态已失效");
    }

    const now = new Date();
    await this.authRepository.revokeSession(tokenHash, now);
    await this.auditRepository.append({
      action: "AUTH_LOGOUT",
      actorUserId: session.userId,
      occurredAt: now,
      result: "SUCCESS",
      targetId: session.userId,
      targetType: "USER",
    });
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toSessionUser(user: StoredUser): SessionUser {
  return {
    id: user.id,
    account: user.account,
    displayName: user.displayName,
    phone: user.phone,
    role: user.role,
  };
}
