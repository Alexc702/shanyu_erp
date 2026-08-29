import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ProjectDetail, SessionUser } from "@shanyu/contracts";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import {
  AUDIT_REPOSITORY,
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
import { HalfPackageCalculator } from "../src/quotation/half-package-calculator";
import { QuotationController } from "../src/quotation/quotation.controller";
import {
  type NewQuotationDraft,
  QUOTATION_REPOSITORY,
  type QuotationDraft,
  type QuotationRepository,
  type QuotationTemplate,
} from "../src/quotation/quotation.repository";
import { QuotationService } from "../src/quotation/quotation.service";

describe("half-package quotation HTTP interface", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const users = await Promise.all([
      storedUser(owner, "owner-password"),
      storedUser(lead, "lead-password"),
      storedUser(unrelatedLead, "other-password"),
      storedUser(woodwork, "woodwork-password"),
    ]);
    const sessions: StoredSession[] = [];
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
    const auditRepository: AuditRepository = { async append() {} };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, QuotationController],
      providers: [
        AccessPolicy,
        AuthService,
        HalfPackageCalculator,
        QuotationService,
        { provide: AUTH_REPOSITORY, useValue: authRepository },
        { provide: AUDIT_REPOSITORY, useValue: auditRepository },
        { provide: QUOTATION_REPOSITORY, useClass: StaticQuotationRepository },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets the project lead save quantity but ignores attempted price and cost overrides", async () => {
    const cookie = await login("alex", "lead-password");
    const opened = await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation`)
      .set("Cookie", cookie)
      .expect(200);
    const line = opened.body.quotation.scopes[0]?.lines[0];
    if (!line) {
      throw new Error("报价响应缺少工程项");
    }

    const saved = await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/lines/${line.id}`,
      )
      .set("Cookie", cookie)
      .send({
        costUnitPrice: "0.0001",
        expectedRevision: 0,
        quantity: "2.0000",
        saleUnitPrice: "0.0001",
        selected: true,
      })
      .expect(200);

    expect(saved.body.quotation).toMatchObject({
      directCost: "124.0000",
      managementFee: "12.4000",
      revision: 1,
      total: "136.4000",
    });
    expect(saved.body.quotation.scopes[0].lines[0]).toMatchObject({
      amount: "124.0000",
      quantity: "2.0000",
      saleUnitPrice: "62.0000",
    });
    expect(JSON.stringify(saved.body)).not.toContain("costUnitPrice");
  });

  it("lets the owner enter but hides project existence from woodwork and unrelated leads", async () => {
    const ownerCookie = await login("owner", "owner-password");
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation`)
      .set("Cookie", ownerCookie)
      .expect(200);

    for (const [account, password] of [
      ["mori", "woodwork-password"],
      ["other", "other-password"],
    ] as const) {
      const cookie = await login(account, password);
      await request(app.getHttpServer())
        .get(`/projects/${project.id}/half-package-quotation`)
        .set("Cookie", cookie)
        .expect(404);
    }
  });

  it("rejects incomplete update payloads before saving", async () => {
    const cookie = await login("alex", "lead-password");
    await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/lines/missing-line`,
      )
      .set("Cookie", cookie)
      .send({ selected: true })
      .expect(400);
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

class StaticQuotationRepository implements QuotationRepository {
  private draft: QuotationDraft | null = null;

  async findProject(): Promise<ProjectDetail | null> {
    return project;
  }

  async findDraft(): Promise<QuotationDraft | null> {
    return this.draft ? structuredClone(this.draft) : null;
  }

  async findPublishedTemplate(): Promise<QuotationTemplate> {
    return template;
  }

  async findTemplate(): Promise<QuotationTemplate> {
    return template;
  }

  async createDraft(input: NewQuotationDraft): Promise<QuotationDraft> {
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async addDraftScopes(input: QuotationDraft): Promise<QuotationDraft> {
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async saveDraft(input: QuotationDraft): Promise<QuotationDraft> {
    this.draft = structuredClone(input);
    return structuredClone(input);
  }
}

const owner: SessionUser = {
  account: "owner",
  displayName: "何总",
  id: "11111111-1111-4111-8111-111111111111",
  phone: null,
  role: "OWNER",
};

const lead: SessionUser = {
  account: "alex",
  displayName: "Alex",
  id: "22222222-2222-4222-8222-222222222222",
  phone: null,
  role: "LEAD_DESIGNER",
};

const unrelatedLead: SessionUser = {
  ...lead,
  account: "other",
  id: "77777777-7777-4777-8777-777777777777",
};

const woodwork: SessionUser = {
  account: "mori",
  displayName: "木作设计师",
  id: "33333333-3333-4333-8333-333333333333",
  phone: null,
  role: "WOODWORK_DESIGNER",
};

const project: ProjectDetail = {
  address: "地址",
  buildingArea: "130.0000",
  customerName: "客户",
  id: "44444444-4444-4444-8444-444444444444",
  leadDesigner: lead,
  name: "静悦府（演示）",
  spaces: [
    {
      area: "18.0000",
      displayName: "主卧",
      height: "2.8000",
      id: "66666666-6666-4666-8666-666666666666",
      includesBalcony: false,
      perimeter: "17.0000",
      sortOrder: 0,
      type: "BEDROOM",
    },
  ],
};

const template: QuotationTemplate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  items: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      itemName: "120墙体拆除",
      remarks: "人工费",
      saleUnitPrice: "62.0000",
      sectionCode: "WALL",
      sectionName: "一、砌墙工程",
      sortOrder: 0,
      unit: "M2",
    },
  ],
  ruleVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  versionNumber: 1,
};

async function storedUser(
  user: SessionUser,
  password: string,
): Promise<StoredUser> {
  return {
    ...user,
    passwordHash: await hashPassword(password),
    status: "ACTIVE",
  };
}
