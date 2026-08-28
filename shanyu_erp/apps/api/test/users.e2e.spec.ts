import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { UserSummary } from "@shanyu/contracts";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRecord,
  type AuditRepository,
} from "../src/access/audit.repository";
import { AuthController } from "../src/access/auth.controller";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type StoredSession,
  type StoredUser,
} from "../src/access/auth.repository";
import { AuthService } from "../src/access/auth.service";
import { hashPassword } from "../src/access/password";
import { UsersController } from "../src/access/users.controller";
import {
  USERS_REPOSITORY,
  type NewUser,
  type UsersRepository,
} from "../src/access/users.repository";
import { UsersService } from "../src/access/users.service";

describe("user management HTTP interface", () => {
  let app: INestApplication;
  let audits: AuditRecord[];
  let users: StoredUser[];

  beforeEach(async () => {
    users = [
      await storedUser("owner-id", "owner", "OWNER", "owner-password"),
      await storedUser(
        "lead-id",
        "alex",
        "LEAD_DESIGNER",
        "lead-password",
      ),
    ];
    const sessions: StoredSession[] = [];
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
        return users.find((user) => user.id === userId) ?? null;
      },
      async findUserByIdentifier(identifier) {
        return users.find((user) => user.account === identifier) ?? null;
      },
      async revokeSession(tokenHash, revokedAt) {
        const session = sessions.find((item) => item.tokenHash === tokenHash);
        if (session) {
          session.revokedAt = revokedAt;
        }
      },
    };
    const usersRepository: UsersRepository = {
      async create(input: NewUser) {
        const user: StoredUser = { ...input, status: "ACTIVE" };
        users.push(user);
        return toSummary(user);
      },
      async list() {
        return users.map(toSummary);
      },
    };
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        AccessPolicy,
        AuthService,
        UsersService,
        { provide: AUTH_REPOSITORY, useValue: authRepository },
        { provide: USERS_REPOSITORY, useValue: usersRepository },
        { provide: AUDIT_REPOSITORY, useValue: auditRepository },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets the owner list users and create a woodwork designer", async () => {
    const cookie = await login("owner", "owner-password");

    await request(app.getHttpServer())
      .get("/users")
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.users).toHaveLength(2);
        expect(JSON.stringify(response.body)).not.toContain("password");
      });

    const response = await request(app.getHttpServer())
      .post("/users")
      .set("Cookie", cookie)
      .send({
        account: "mori",
        displayName: "木作设计师",
        password: "woodwork-password",
        phone: null,
        role: "WOODWORK_DESIGNER",
      })
      .expect(201);

    expect(response.body.user).toMatchObject({
      account: "mori",
      displayName: "木作设计师",
      role: "WOODWORK_DESIGNER",
      status: "ACTIVE",
    });
    expect(JSON.stringify(response.body)).not.toContain("woodwork-password");
    expect(audits.at(-1)).toMatchObject({
      action: "USER_CREATED",
      actorUserId: "owner-id",
      result: "SUCCESS",
      targetType: "USER",
    });
  });

  it("does not let a lead designer forge the owner role", async () => {
    const cookie = await login("alex", "lead-password");

    await request(app.getHttpServer())
      .get("/users")
      .set("Cookie", cookie)
      .set("X-User-Role", "OWNER")
      .expect(403);

    await request(app.getHttpServer())
      .post("/users")
      .set("Cookie", cookie)
      .send({
        account: "forged",
        displayName: "伪造老板",
        password: "forged-password",
        phone: null,
        role: "OWNER",
      })
      .expect(403);

    expect(users).toHaveLength(2);
  });

  async function login(account: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ identifier: account, password, rememberMe: false })
      .expect(200);
    const cookie = response.headers["set-cookie"]?.[0];
    if (!cookie) {
      throw new Error("登录后应返回会话 Cookie");
    }
    return cookie;
  }
});

async function storedUser(
  id: string,
  account: string,
  role: StoredUser["role"],
  password: string,
): Promise<StoredUser> {
  return {
    account,
    displayName: account,
    id,
    passwordHash: await hashPassword(password),
    phone: null,
    role,
    status: "ACTIVE",
  };
}

function toSummary(user: StoredUser): UserSummary {
  return {
    account: user.account,
    displayName: user.displayName,
    id: user.id,
    phone: user.phone,
    role: user.role,
    status: user.status,
  };
}
