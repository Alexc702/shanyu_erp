import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthController } from "../src/access/auth.controller";
import {
  AUDIT_REPOSITORY,
  type AuditRecord,
  type AuditRepository,
} from "../src/access/audit.repository";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type StoredSession,
  type StoredUser,
} from "../src/access/auth.repository";
import { AuthService } from "../src/access/auth.service";
import { hashPassword } from "../src/access/password";

describe("authentication HTTP interface", () => {
  let app: INestApplication;
  let audits: AuditRecord[];
  let sessions: StoredSession[];

  beforeEach(async () => {
    const owner: StoredUser = {
      id: "11111111-1111-4111-8111-111111111111",
      account: "he.owner",
      displayName: "何老板",
      passwordHash: await hashPassword("owner-password"),
      phone: "13800000000",
      role: "OWNER",
      status: "ACTIVE",
    };
    sessions = [];
    audits = [];

    const authRepository: AuthRepository = {
      async createSession(session) {
        sessions.push(session);
      },
      async findActiveSessionByTokenHash(tokenHash) {
        return (
          sessions.find(
            (session) =>
              session.tokenHash === tokenHash && session.revokedAt === null,
          ) ?? null
        );
      },
      async findUserById(userId) {
        return userId === owner.id ? owner : null;
      },
      async findUserByIdentifier(identifier) {
        return identifier === owner.account || identifier === owner.phone
          ? owner
          : null;
      },
      async revokeSession(tokenHash, revokedAt) {
        const session = sessions.find(
          (candidate) => candidate.tokenHash === tokenHash,
        );
        if (session) {
          session.revokedAt = revokedAt;
        }
      },
    };
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: AUTH_REPOSITORY, useValue: authRepository },
        { provide: AUDIT_REPOSITORY, useValue: auditRepository },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("logs an active owner in without exposing credential data", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: "he.owner",
        password: "owner-password",
        rememberMe: false,
      })
      .expect(200);

    expect(response.body).toEqual({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        account: "he.owner",
        displayName: "何老板",
        phone: "13800000000",
        role: "OWNER",
      },
    });
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(audits).toMatchObject([
      {
        action: "AUTH_LOGIN",
        actorUserId: ownerId,
        result: "SUCCESS",
        targetId: ownerId,
        targetType: "USER",
      },
    ]);
  });

  it("rejects invalid credentials without setting a session cookie", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: "he.owner",
        password: "wrong-password",
        rememberMe: false,
      })
      .expect(401);

    expect(response.body.message).toBe("账号或密码错误");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(sessions).toHaveLength(0);
    expect(audits).toMatchObject([
      {
        action: "AUTH_LOGIN",
        actorUserId: ownerId,
        result: "FAILURE",
      },
    ]);
  });

  it("returns the current user for a valid session and revokes it on logout", async () => {
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: "13800000000",
        password: "owner-password",
        rememberMe: true,
      })
      .expect(200);
    const cookie = loginResponse.headers["set-cookie"]?.[0];

    expect(cookie).toBeDefined();
    await request(app.getHttpServer())
      .get("/auth/session")
      .set("Cookie", cookie ?? "")
      .expect(200)
      .expect({ user: loginResponse.body.user });

    const logoutResponse = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie ?? "")
      .expect(204);

    expect(logoutResponse.headers["set-cookie"]?.[0]).toContain(
      "shanyu_session=;",
    );
    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits.at(-1)).toMatchObject({
      action: "AUTH_LOGOUT",
      actorUserId: ownerId,
      result: "SUCCESS",
    });

    await request(app.getHttpServer())
      .get("/auth/session")
      .set("Cookie", cookie ?? "")
      .expect(401);
  });

  it("rejects missing and expired sessions", async () => {
    await request(app.getHttpServer()).get("/auth/session").expect(401);

    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: "he.owner",
        password: "owner-password",
        rememberMe: false,
      })
      .expect(200);
    const cookie = loginResponse.headers["set-cookie"]?.[0];
    const session = sessions[0];
    if (!session) {
      throw new Error("登录后应创建会话");
    }
    sessions[0] = { ...session, expiresAt: new Date(0) };

    await request(app.getHttpServer())
      .get("/auth/session")
      .set("Cookie", cookie ?? "")
      .expect(401);
  });
});

const ownerId = "11111111-1111-4111-8111-111111111111";
