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
import {
  QuotationApprovalController,
  QuotationController,
  QuotationExportController,
} from "../src/quotation/quotation.controller";
import { QuotationExporter } from "../src/quotation/quotation-exporter";
import {
  type NewQuotationDraft,
  type NewQuotationExport,
  QUOTATION_REPOSITORY,
  type QuotationDraft,
  type QuotationDecisionAction,
  type QuotationExport,
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
      controllers: [
        AuthController,
        QuotationController,
        QuotationApprovalController,
        QuotationExportController,
      ],
      providers: [
        AccessPolicy,
        AuthService,
        HalfPackageCalculator,
        QuotationExporter,
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
    for (const sensitiveField of [
      "costAmount",
      "costVersion",
      "expectedCost",
      "grossMarginRate",
      "grossProfit",
    ]) {
      expect(JSON.stringify(saved.body)).not.toContain(sensitiveField);
    }

    const ownerCookie = await login("owner", "owner-password");
    const ownerCost = await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation/cost-margin`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(ownerCost.body.costMargin).toMatchObject({
      costVersion: { id: template.id, versionNumber: 1 },
      expectedCost: "80.0000",
      grossMarginRate: "0.3548",
      grossProfit: "44.0000",
      salesAmount: "124.0000",
    });
    expect(ownerCost.body.costMargin.scopes[0].lines[0]).toMatchObject({
      costAmount: "80.0000",
      costUnitPrice: "40.0000",
      saleAmount: "124.0000",
    });

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation/cost-margin`)
      .set("Cookie", cookie)
      .expect(403);
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
      const deniedCost = await request(app.getHttpServer())
        .get(`/projects/${project.id}/half-package-quotation/cost-margin`)
        .set("Cookie", cookie)
        .expect(403);
      expect(JSON.stringify(deniedCost.body)).not.toContain(project.name);
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

  it("enforces submit, owner approval and approved-only customer export", async () => {
    const leadCookie = await login("alex", "lead-password");
    const opened = await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation`)
      .set("Cookie", leadCookie)
      .expect(200);
    const quotationId = opened.body.quotation.id as string;

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/half-package-quotation/submit`)
      .set("Cookie", leadCookie)
      .send({ expectedRevision: opened.body.quotation.revision })
      .expect(201)
      .expect(({ body }) => {
        expect(body.quotation.status).toBe("PENDING_APPROVAL");
      });
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/decision`)
      .set("Cookie", leadCookie)
      .send({ action: "APPROVED", reason: null })
      .expect(403);

    const ownerCookie = await login("owner", "owner-password");
    await request(app.getHttpServer())
      .get("/approvals/half-package")
      .set("Cookie", ownerCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.quotations).toHaveLength(1);
      });
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/decision`)
      .set("Cookie", ownerCookie)
      .send({ action: "APPROVED", reason: null })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/exports`)
      .set("Cookie", ownerCookie)
      .send({ format: "XLSX" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.export.fileName).toContain("半包报价");
        expect(body.export.sha256).toHaveLength(64);
      });
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
  private exports: QuotationExport[] = [];

  async findProject(): Promise<ProjectDetail | null> {
    return project;
  }

  async findDraft(): Promise<QuotationDraft | null> {
    return this.draft?.status === "DRAFT" ? structuredClone(this.draft) : null;
  }

  async findLatest(): Promise<QuotationDraft | null> {
    return this.draft ? structuredClone(this.draft) : null;
  }

  async findById(): Promise<QuotationDraft | null> {
    return this.draft ? structuredClone(this.draft) : null;
  }

  async listByProject(): Promise<readonly QuotationDraft[]> {
    return this.draft ? [structuredClone(this.draft)] : [];
  }

  async listPendingApproval(): Promise<readonly QuotationDraft[]> {
    return this.draft?.status === "PENDING_APPROVAL"
      ? [structuredClone(this.draft)]
      : [];
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

  async submitDraft(
    _quotationId: string,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing draft");
    this.draft = {
      ...this.draft,
      status: "PENDING_APPROVAL",
      submittedAt: new Date("2026-08-30T00:00:00Z"),
      submittedByUserId: actorUserId,
    };
    return structuredClone(this.draft);
  }

  async decide(
    _quotationId: string,
    actorUserId: string,
    action: QuotationDecisionAction,
    reason: string | null,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing quotation");
    this.draft = {
      ...this.draft,
      decidedAt: new Date("2026-08-30T01:00:00Z"),
      decidedByUserId: actorUserId,
      decisionAction: action,
      decisionReason: reason,
      status: action === "RETURNED" ? "RETURNED" : "APPROVED",
    };
    return structuredClone(this.draft);
  }

  async createDraftFromVersion(
    source: QuotationDraft,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    this.draft = {
      ...structuredClone(source),
      createdByUserId: actorUserId,
      id: `${source.id}-copy`,
      parentVersionId: source.id,
      status: "DRAFT",
      submittedAt: null,
      submittedByUserId: null,
      versionNumber: source.versionNumber + 1,
    };
    return structuredClone(this.draft);
  }

  async createExport(input: NewQuotationExport): Promise<QuotationExport> {
    this.exports.push(input);
    return input;
  }

  async findExport(exportId: string): Promise<QuotationExport | null> {
    return this.exports.find((item) => item.id === exportId) ?? null;
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
      costUnitPrice: "40.0000",
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
