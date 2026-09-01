import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { UserSummary } from "@shanyu/contracts";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import { AUDIT_QUERY_REPOSITORY } from "../src/access/audit-query.repository";
import { AuditQueryService } from "../src/access/audit-query.service";
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
  DuplicateUserError,
  LastActiveAdministratorError,
  USERS_REPOSITORY,
  type NewUser,
  type UpdatedUser,
  type UsersRepository,
  UserNotFoundError,
} from "../src/access/users.repository";
import { UsersService } from "../src/access/users.service";

describe("user management HTTP interface", () => {
  let app: INestApplication;
  let audits: AuditRecord[];
  let sessions: StoredSession[];
  let users: StoredUser[];

  beforeEach(async () => {
    users = [
      await storedUser("admin-id", "admin", "ADMIN", "admin-password"),
      await storedUser("owner-id", "owner", "OWNER", "owner-password"),
      await storedUser(
        "lead-id",
        "alex",
        "LEAD_DESIGNER",
        "lead-password",
      ),
    ];
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
        if (users.some((user) => user.account === input.account)) {
          throw new DuplicateUserError();
        }
        const user: StoredUser = { ...input, status: "ACTIVE" };
        users.push(user);
        return toSummary(user);
      },
      async disable(userId) {
        const index = users.findIndex((user) => user.id === userId);
        const current = users[index];
        if (!current) throw new UserNotFoundError();
        if (
          current.role === "ADMIN" &&
          !users.some(
            (user) =>
              user.id !== userId &&
              user.role === "ADMIN" &&
              user.status === "ACTIVE",
          )
        ) {
          throw new LastActiveAdministratorError();
        }
        const user: StoredUser = { ...current, status: "DISABLED" };
        users[index] = user;
        for (const session of sessions) {
          if (session.userId === userId && session.revokedAt === null) {
            session.revokedAt = new Date();
          }
        }
        return toSummary(user);
      },
      async findById(userId) {
        const user = users.find((item) => item.id === userId);
        return user ? toSummary(user) : null;
      },
      async list() {
        return users.map(toSummary);
      },
      async resetPassword(userId, passwordHash) {
        const index = users.findIndex((user) => user.id === userId);
        const current = users[index];
        if (!current) throw new UserNotFoundError();
        users[index] = { ...current, passwordHash };
        for (const session of sessions) {
          if (session.userId === userId && session.revokedAt === null) {
            session.revokedAt = new Date();
          }
        }
      },
      async update(input: UpdatedUser) {
        const index = users.findIndex((user) => user.id === input.id);
        const current = users[index];
        if (!current) throw new UserNotFoundError();
        if (
          current.role === "ADMIN" &&
          input.role !== "ADMIN" &&
          !users.some(
            (user) =>
              user.id !== input.id &&
              user.role === "ADMIN" &&
              user.status === "ACTIVE",
          )
        ) {
          throw new LastActiveAdministratorError();
        }
        if (
          users.some(
            (user) => user.id !== input.id && user.account === input.account,
          )
        ) {
          throw new DuplicateUserError();
        }
        const user: StoredUser = { ...current, ...input };
        users[index] = user;
        return toSummary(user);
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
        AuditQueryService,
        AuthService,
        UsersService,
        { provide: AUDIT_QUERY_REPOSITORY, useValue: { async list() { return []; } } },
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
        password: "Woodwork123",
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
    expect(JSON.stringify(response.body)).not.toContain("Woodwork123");
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
        password: "Forged123",
        phone: null,
        role: "OWNER",
      })
      .expect(403);

    expect(users).toHaveLength(3);
  });

  it("lets the owner edit, reset and delete another non-administrator account", async () => {
    const ownerCookie = await login("owner", "owner-password");

    await request(app.getHttpServer())
      .patch("/users/lead-id")
      .set("Cookie", ownerCookie)
      .send({ account: "alex.chen", displayName: "陈 Alex", role: "LEAD_DESIGNER" })
      .expect(200)
      .expect((response) => {
        expect(response.body.user).toMatchObject({
          account: "alex.chen",
          displayName: "陈 Alex",
        });
      });

    await request(app.getHttpServer())
      .put("/users/lead-id/password")
      .set("Cookie", ownerCookie)
      .send({ password: "NewLead123" })
      .expect(200);
    await login("alex.chen", "NewLead123");

    await request(app.getHttpServer())
      .delete("/users/lead-id")
      .set("Cookie", ownerCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.user.status).toBe("DISABLED");
      });

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ identifier: "alex.chen", password: "NewLead123", rememberMe: false })
      .expect(401);
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "USER_UPDATED",
        "USER_PASSWORD_RESET",
        "USER_DELETED",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain("NewLead123");
  });

  it("hides administrators from owners and refuses owner self-management", async () => {
    const cookie = await login("owner", "owner-password");

    await request(app.getHttpServer())
      .get("/users")
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.users).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "ADMIN" })]),
        );
      });
    await request(app.getHttpServer())
      .delete("/users/owner-id")
      .set("Cookie", cookie)
      .expect(403);
    await request(app.getHttpServer())
      .patch("/users/admin-id")
      .set("Cookie", cookie)
      .send({ account: "admin", displayName: "管理员", role: "OWNER" })
      .expect(404);
    await request(app.getHttpServer())
      .post("/users")
      .set("Cookie", cookie)
      .send({
        account: "admin2",
        displayName: "管理员 2",
        password: "AdminTwo123",
        phone: null,
        role: "ADMIN",
      })
      .expect(403);
    await request(app.getHttpServer())
      .post("/users")
      .set("Cookie", cookie)
      .send({
        account: "finance2",
        displayName: "财务 2",
        password: "FinanceTwo123",
        phone: null,
        role: "FINANCE",
      })
      .expect(403);
  });

  it("lets administrators manage administrators while preserving one active administrator", async () => {
    const cookie = await login("admin", "admin-password");
    await request(app.getHttpServer())
      .get("/users")
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.users).toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "ADMIN" })]),
        );
      });

    await request(app.getHttpServer())
      .delete("/users/admin-id")
      .set("Cookie", cookie)
      .expect(409);

    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Cookie", cookie)
      .send({
        account: "admin2",
        displayName: "管理员 2",
        password: "AdminTwo123",
        phone: null,
        role: "ADMIN",
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/users/${created.body.user.id}`)
      .set("Cookie", cookie)
      .expect(200);
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
