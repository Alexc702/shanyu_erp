import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ProjectDetail, SessionUser } from "@shanyu/contracts";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
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
import { DatabaseClient } from "../src/database/database.client";
import { HalfPackageCalculator } from "../src/quotation/half-package-calculator";
import {
  QuotationApprovalController,
  QuotationController,
  QuotationExportController,
} from "../src/quotation/quotation.controller";
import { QuotationExporter } from "../src/quotation/quotation-exporter";
import {
  type ConfirmedQuotationAdjustment,
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
      grossMarginRate: "0.4135",
      grossProfit: "56.4000",
      marginBenchmarkRate: "0.3000",
      salesAmount: "136.4000",
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
    await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/versions/${ownerCost.body.costMargin.id}/margin-benchmark`,
      )
      .set("Cookie", cookie)
      .send({ marginBenchmarkPercent: "35" })
      .expect(403);
    await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/versions/${ownerCost.body.costMargin.id}/margin-benchmark`,
      )
      .set("Cookie", ownerCookie)
      .send({ marginBenchmarkPercent: "35" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.costMargin.marginBenchmarkRate).toBe("0.3500");
      });
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
      expect(JSON.stringify(deniedCost.body)).not.toContain(project.projectAddress);
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

  it("submits discount approval before export and enforces owner-only final approval", async () => {
    const leadCookie = await login("alex", "lead-password");
    const opened = await request(app.getHttpServer())
      .get(`/projects/${project.id}/half-package-quotation`)
      .set("Cookie", leadCookie)
      .expect(200);
    const quotationId = opened.body.quotation.id as string;
    const lineId = opened.body.quotation.scopes[0]?.lines[0]?.id as
      | string
      | undefined;
    if (!lineId) throw new Error("报价响应缺少工程项");
    const saved = await request(app.getHttpServer())
      .patch(`/projects/${project.id}/half-package-quotation/lines/${lineId}`)
      .set("Cookie", leadCookie)
      .send({
        expectedRevision: opened.body.quotation.revision,
        quantity: "2.0000",
        selected: true,
      })
      .expect(200);

    const quoted = await request(app.getHttpServer())
      .post(`/projects/${project.id}/half-package-quotation/submit`)
      .set("Cookie", leadCookie)
      .send({ expectedRevision: saved.body.quotation.revision })
      .expect(201)
      .expect(({ body }) => {
        expect(body.quotation.status).toBe("QUOTED");
      });
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/decision`)
      .set("Cookie", leadCookie)
      .send({ action: "APPROVED", reason: null })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/exports`)
      .set("Cookie", leadCookie)
      .send({ format: "PDF" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/versions/${quotationId}/adjustment`,
      )
      .set("Cookie", leadCookie)
      .send({
        action: "SUBMIT_FOR_APPROVAL",
        discountRate: "0.9500",
        expectedRevision: quoted.body.quotation.revision,
        reason: "  ",
        writeOff: "1.0000",
      })
      .expect(400);

    const adjusted = await request(app.getHttpServer())
      .patch(
        `/projects/${project.id}/half-package-quotation/versions/${quotationId}/adjustment`,
      )
      .set("Cookie", leadCookie)
      .send({
        action: "SUBMIT_FOR_APPROVAL",
        discountRate: "0.9500",
        expectedRevision: quoted.body.quotation.revision,
        reason: "客户确认九五折并抹零",
        writeOff: "1.0000",
      })
      .expect(200);
    expect(adjusted.body.quotation).toMatchObject({
      adjustedTotal: "128.5800",
      adjustmentStatus: "PENDING_APPROVAL",
      discountRate: "0.9500",
      writeOff: "1.0000",
    });

    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/exports`)
      .set("Cookie", leadCookie)
      .send({ format: "PDF" })
      .expect(409);

    const ownerCookie = await login("owner", "owner-password");
    await request(app.getHttpServer())
      .get("/approvals/half-package")
      .set("Cookie", ownerCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.quotations).toEqual([
          expect.objectContaining({
            expectedCost: expect.any(String),
            grossMarginRate: expect.any(String),
            grossProfit: expect.any(String),
            salesAmount: "128.5800",
            thirdPartyPurchaseAmount: null,
          }),
        ]);
      });
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/decision`)
      .set("Cookie", ownerCookie)
      .send({ action: "SPECIAL_APPROVED", reason: "不再提供特批" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/approvals/half-package/${quotationId}/decision`)
      .set("Cookie", ownerCookie)
      .send({ action: "APPROVED", reason: null })
      .expect(201)
      .expect(({ body }) => {
        expect(body.quotation).toMatchObject({
          adjustmentStatus: "CONFIRMED",
          status: "APPROVED",
        });
      });

    for (const expected of [
      {
        contentType: "application/pdf",
        format: "PDF",
        signature: "%PDF",
      },
      {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "XLSX",
        signature: "PK",
      },
    ] as const) {
      const createdExport = await request(app.getHttpServer())
        .post(`/approvals/half-package/${quotationId}/exports`)
        .set("Cookie", leadCookie)
        .send({ format: expected.format })
        .expect(201);
      const exported = createdExport.body.export as {
        downloadPath: string;
        fileName: string;
        sha256: string;
      };
      expect(exported.fileName).toContain("项目报价");
      expect(exported.sha256).toHaveLength(64);

      const downloaded = await request(app.getHttpServer())
        .get(exported.downloadPath)
        .set("Cookie", leadCookie)
        .buffer(true)
        .parse(bufferResponse)
        .expect(200)
        .expect("Content-Type", expected.contentType);
      expect(downloaded.headers["content-disposition"]).toContain(
        encodeURIComponent(exported.fileName),
      );
      expect(Buffer.isBuffer(downloaded.body)).toBe(true);
      expect(downloaded.body.subarray(0, expected.signature.length).toString()).toBe(
        expected.signature,
      );
      if (expected.format === "PDF") {
        expect(await exportedPdfSectionOrder(downloaded.body)).toEqual([
          "COVER",
          "BUDGET",
          "HALF",
          "MAIN",
        ]);
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          downloaded.body as unknown as Parameters<typeof workbook.xlsx.load>[0],
        );
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
          "封面",
          "预算说明书",
          "半包报价单",
          "主材报价单",
        ]);
        expect(workbook.getWorksheet("封面")?.getCell("A4").text)
          .toContain(project.projectAddress);
        const summary = exportedQuotationSummary(
          workbook.getWorksheet("半包报价单"),
        );
        expect(summary.map((row) => row.label)).toEqual([
          "直接费",
          "管理费",
          "折扣和抹零",
          "税金",
          "总造价",
        ]);
        expect(summary.at(-2)?.amount).toBe(7.71);
        expect(summary.at(-1)?.amount).toBe(136.29);
        expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues())))
          .not.toContain("成本");
      }

      await request(app.getHttpServer())
        .get(exported.downloadPath)
        .expect(401);
    }

  }, 120_000);

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

describe("half-package quotation PostgreSQL concurrency", () => {
  it(
    "creates exactly one complete first version when ten first requests arrive concurrently",
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const realApp = moduleRef.createNestApplication();
      await realApp.init();

      const database = realApp.get(DatabaseClient);
      const userId = randomUUID();
      const ownerId = randomUUID();
      const account = `quote-race-${userId.slice(0, 8)}`;
      const ownerAccount = `quote-owner-${ownerId.slice(0, 8)}`;
      const password = "quotation-concurrency-password";
      let projectId: string | null = null;

      try {
        await database.query(
          `INSERT INTO users (id, account, display_name, role, status)
           VALUES ($1, $2, '并发测试主案', 'LEAD_DESIGNER', 'ACTIVE'),
                  ($3, $4, '并发测试老板', 'OWNER', 'ACTIVE')`,
          [userId, account, ownerId, ownerAccount],
        );
        await database.query(
          `INSERT INTO user_credentials (user_id, password_hash)
           VALUES ($1, $3), ($2, $3)`,
          [userId, ownerId, await hashPassword(password)],
        );

        const loginResponse = await request(realApp.getHttpServer())
          .post("/auth/login")
          .send({ identifier: account, password, rememberMe: false })
          .expect(200);
        const cookie = loginResponse.headers["set-cookie"]?.[0];
        if (!cookie) throw new Error("并发测试登录后缺少会话 Cookie");
        const ownerLoginResponse = await request(realApp.getHttpServer())
          .post("/auth/login")
          .send({ identifier: ownerAccount, password, rememberMe: false })
          .expect(200);
        const ownerCookie = ownerLoginResponse.headers["set-cookie"]?.[0];
        if (!ownerCookie) throw new Error("并发测试老板登录后缺少会话 Cookie");

        const createdProject = await request(realApp.getHttpServer())
          .post("/projects")
          .set("Cookie", cookie)
          .send({
            outerFrameArea: "100.00",
            customerName: "并发测试客户",
            leadDesignerId: userId,
            projectAddress: `并发测试-${userId.slice(0, 6)}`,
            spaces: [
              {
                area: "20.0000",
                displayName: "主卧",
                height: "2.8000",
                includesBalcony: false,
                perimeter: "18.0000",
                type: "BEDROOM",
              },
              {
                area: "32.0000",
                displayName: "客餐厅",
                height: "2.8000",
                includesBalcony: false,
                perimeter: "24.0000",
                type: "LIVING_DINING",
              },
              {
                area: "15.0000",
                displayName: "次卧",
                height: "2.8000",
                includesBalcony: false,
                perimeter: "16.0000",
                type: "BEDROOM",
              },
            ],
          })
          .expect(201);
        projectId = createdProject.body.project.id as string;

        const responses = await Promise.all(
          Array.from({ length: 10 }, () =>
            request(realApp.getHttpServer())
              .get(`/projects/${projectId}/half-package-quotation`)
              .set("Cookie", cookie),
          ),
        );

        expect(responses.map((response) => response.status)).toEqual(
          Array.from({ length: 10 }, () => 200),
        );
        const quotations = responses.map(
          (response) => response.body.quotation as {
            id: string;
            revision: number;
            scopes: unknown[];
          },
        );
        expect(new Set(quotations.map((quotation) => quotation.id)).size).toBe(1);
        expect(quotations[0]?.scopes.length).toBeGreaterThan(0);
        for (const quotation of quotations.slice(1)) {
          expect(quotation.scopes).toEqual(quotations[0]?.scopes);
        }

        let initial = quotations[0];
        if (!initial) throw new Error("并发请求未返回报价");
        const initialItemNames = (
          initial.scopes as Array<{ lines: Array<{ itemName: string }> }>
        ).flatMap((scope) => scope.lines.map((line) => line.itemName));
        expect(initialItemNames).toEqual(
          expect.arrayContaining([
            "100*100mm小砖（水泥砂浆粘贴）",
            "200*200mm小砖（水泥砂浆粘贴）",
            "100*100mm小砖（胶泥粘帖）",
            "200*200mm小砖（胶泥粘帖）",
          ]),
        );
        const legacyTile = await database.query<{ id: string }>(
          `SELECT l.id
             FROM half_package_quotation_lines l
             JOIN half_package_quotation_spaces qs ON qs.id = l.quotation_space_id
            WHERE qs.quotation_id = $1
              AND l.item_name = '600*1200mm地砖（水泥砂浆粘贴）'
            LIMIT 1`,
          [initial.id],
        );
        if (!legacyTile.rows[0]) throw new Error("兼容测试缺少 600*1200 地砖");
        await database.query(
          `UPDATE half_package_quotation_lines l
              SET selected = true, quantity_rule_kind = 'SPACE_AREA',
                  calculated_quantity = qs.area,
                  sale_amount = round(qs.area * l.sale_unit_price, 4),
                  cost_amount = round(qs.area * l.cost_unit_price, 4),
                  gross_profit = round(qs.area * (l.sale_unit_price - l.cost_unit_price), 4),
                  gross_margin_rate = round(
                    (l.sale_unit_price - l.cost_unit_price) / l.sale_unit_price,
                    4
                  )
             FROM half_package_quotation_spaces qs
            WHERE l.id = $1 AND qs.id = l.quotation_space_id`,
          [legacyTile.rows[0].id],
        );
        await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/main-material-quotation`)
          .set("Cookie", cookie)
          .expect(200);
        const legacyDemand = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM main_material_quote_lines
            WHERE source_half_package_line_id = $1`,
          [legacyTile.rows[0].id],
        );
        expect(legacyDemand.rows[0]?.count).toBe("1");
        const repairedLegacy = await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/half-package-quotation`)
          .set("Cookie", cookie)
          .expect(200);
        const repairedTile = (
          repairedLegacy.body.quotation.scopes as Array<{
            lines: Array<{
              id: string;
              quantity: string | null;
              quantitySource: string;
              selected: boolean;
            }>;
          }>
        )
          .flatMap((scope) => scope.lines)
          .find((line) => line.id === legacyTile.rows[0]!.id);
        expect(repairedTile).toMatchObject({
          quantity: null,
          quantitySource: "MANUAL",
          selected: false,
        });
        const removedLegacyDemand = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM main_material_quote_lines
            WHERE source_half_package_line_id = $1`,
          [legacyTile.rows[0].id],
        );
        expect(removedLegacyDemand.rows[0]?.count).toBe("0");
        initial = repairedLegacy.body.quotation;
        const projectSpaces = createdProject.body.project.spaces as Array<{
          displayName: string;
          id: string;
        }>;
        const reorderedIds = [
          projectSpaces[1]!.id,
          projectSpaces[0]!.id,
          projectSpaces[2]!.id,
        ];
        await request(realApp.getHttpServer())
          .put(`/projects/${projectId}/spaces/order`)
          .set("Cookie", cookie)
          .send({ spaceIds: reorderedIds })
          .expect(200);
        await request(realApp.getHttpServer())
          .get(`/projects/${projectId}`)
          .set("Cookie", cookie)
          .expect(200)
          .expect(({ body }) => {
            expect(
              (body.project.spaces as Array<{ id: string }>).map((space) => space.id),
            ).toEqual(reorderedIds);
          });
        const reorderedQuotation = await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/half-package-quotation`)
          .set("Cookie", cookie)
          .expect(200);
        expect(
          (reorderedQuotation.body.quotation.scopes as Array<{
            name: string;
            projectSpaceId: string | null;
          }>)
            .filter((scope) => scope.projectSpaceId)
            .map((scope) => scope.name),
        ).toEqual(["客餐厅", "主卧", "次卧"]);
        initial = reorderedQuotation.body.quotation;
        const projectSpace = createdProject.body.project.spaces[0] as
          | { id: string }
          | undefined;
        const manualLine = initial?.scopes
          .flatMap((scope) =>
            (scope as { lines: Array<{ id: string; quantitySource: string }> })
              .lines,
          )
          .find((line) => line.quantitySource === "MANUAL");
        if (!initial || !projectSpace || !manualLine) {
          throw new Error("空间参数测试缺少报价、空间或手工工程项");
        }
        const manuallyUpdated = await request(realApp.getHttpServer())
          .patch(
            `/projects/${projectId}/half-package-quotation/lines/${manualLine.id}`,
          )
          .set("Cookie", cookie)
          .send({
            expectedRevision: initial.revision,
            quantity: "3.0000",
            selected: true,
          })
          .expect(200);
        await request(realApp.getHttpServer())
          .patch(`/projects/${projectId}/spaces/${projectSpace.id}`)
          .set("Cookie", cookie)
          .send({
            area: "25.0000",
            displayName: "主卧",
            height: "3.0000",
            includesBalcony: false,
            perimeter: "20.0000",
            type: "BEDROOM",
          })
          .expect(200);
        const recalculated = await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/half-package-quotation`)
          .set("Cookie", cookie)
          .expect(200);
        const recalculatedScopes = recalculated.body.quotation.scopes as Array<{
            projectSpaceId: string | null;
            lines: Array<{
              id: string;
              itemName: string;
              quantity: string | null;
            }>;
          }>;
        const recalculatedScope = recalculatedScopes.find(
          (scope) => scope.projectSpaceId === projectSpace.id,
        );
        if (!recalculatedScope) throw new Error("空间参数测试缺少主卧报价范围");
        const recalculatedLines = recalculatedScope.lines;
        expect(
          recalculatedLines.find((line) => line.itemName === "顶面基层处理")
            ?.quantity,
        ).toBe("25.0000");
        expect(
          recalculatedLines.find((line) => line.itemName === "墙面基层处理")
            ?.quantity,
        ).toBe("60.0000");
        expect(
          recalculatedScopes
            .flatMap((scope) => scope.lines)
            .find((line) => line.id === manualLine.id)?.quantity,
        ).toBe("3.0000");
        expect(recalculated.body.quotation.revision).toBe(
          manuallyUpdated.body.quotation.revision + 1,
        );

        await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/half-package-quotation/versions`)
          .set("Cookie", cookie)
          .expect(200)
          .expect(({ body }) => {
            expect(body.versions).toHaveLength(1);
            expect(body.versions[0]).toMatchObject({ versionNumber: 1 });
          });

        const tileLine = recalculatedScopes
          .flatMap((scope) => scope.lines)
          .find((line) => line.itemName === "800*800mm地砖（水泥砂浆粘贴）");
        if (!tileLine) throw new Error("需求数量测试缺少半包瓷砖行");
        await request(realApp.getHttpServer())
          .patch(`/projects/${projectId}/half-package-quotation/lines/${tileLine.id}`)
          .set("Cookie", cookie)
          .send({
            expectedRevision: recalculated.body.quotation.revision,
            quantity: "8.0000",
            selected: true,
          })
          .expect(200);

        const materialResponse = await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/main-material-quotation`)
          .set("Cookie", cookie)
          .expect(200);
        const catalogResponse = await request(realApp.getHttpServer())
          .get(`/projects/${projectId}/main-material-quotation/catalog`)
          .set("Cookie", cookie)
          .expect(200);
        expect(catalogResponse.body.catalog).toMatchObject({
          name: "山屿 ERP 主材库 0912 石材品牌修正",
        });
        expect(catalogResponse.body.catalog.items).toHaveLength(589);
        let materialQuotation = materialResponse.body.quotation as {
          lines: Array<{
            baseQuantity: string | null;
            categoryCode: string;
            demandSpec: string;
            id: string;
            item: unknown;
            lossRate: string;
            origin: string;
            quantity: string;
          }>;
          revision: number;
        };
        const editableDemand = materialQuotation.lines.find(
          (candidate) => candidate.origin === "AUTO_TILE",
        );
        if (!editableDemand) throw new Error("需求数量测试缺少自动瓷砖行");
        if (!editableDemand.baseQuantity) throw new Error("瓷砖需求缺少半包基础数量");
        await request(realApp.getHttpServer())
          .patch(
            `/projects/${projectId}/main-material-quotation/lines/${editableDemand.id}/demand`,
          )
          .set("Cookie", cookie)
          .send({
            baseQuantity: "12.5000",
            expectedRevision: materialQuotation.revision,
            lossRate: "0.1150",
          })
          .expect(400);
        const demandUpdated = await request(realApp.getHttpServer())
          .patch(
            `/projects/${projectId}/main-material-quotation/lines/${editableDemand.id}/demand`,
          )
          .set("Cookie", cookie)
          .send({
            baseQuantity: editableDemand.baseQuantity,
            expectedRevision: materialQuotation.revision,
            lossRate: "0.2000",
          })
          .expect(200);
        materialQuotation = demandUpdated.body.quotation;
        expect(
          materialQuotation.lines.find((line) => line.id === editableDemand.id),
        ).toMatchObject({
          baseQuantity: editableDemand.baseQuantity,
          lossRate: "0.2000",
          quantity: (Number(editableDemand.baseQuantity) * 1.2).toFixed(4),
        });
        const materialItems = catalogResponse.body.catalog.items as Array<{
          categoryCode: string;
          colors: string[];
          id: string;
          spec: string;
        }>;
        const seamItem = materialItems.find(
          (candidate) => candidate.categoryCode === "SEAM",
        );
        if (!seamItem) throw new Error("非瓷砖需求测试缺少美缝商品");
        const manualAdded = await request(realApp.getHttpServer())
          .post(`/projects/${projectId}/main-material-quotation/lines`)
          .set("Cookie", cookie)
          .send({
            categoryCode: "SEAM",
            color: seamItem.colors[0] ?? null,
            expectedRevision: materialQuotation.revision,
            itemVersionId: seamItem.id,
            quantity: "6.0000",
          })
          .expect(201);
        materialQuotation = manualAdded.body.quotation;
        const seamLine = materialQuotation.lines.find(
          (candidate) => candidate.origin === "MANUAL" && candidate.categoryCode === "SEAM",
        );
        if (!seamLine) throw new Error("非瓷砖需求测试缺少美缝报价行");
        expect(seamLine).toMatchObject({
          baseQuantity: "6.0000",
          lossRate: "0.0000",
          quantity: "6.0000",
        });
        const manualDemandUpdated = await request(realApp.getHttpServer())
          .patch(
            `/projects/${projectId}/main-material-quotation/lines/${seamLine.id}/demand`,
          )
          .set("Cookie", cookie)
          .send({
            baseQuantity: "5.0000",
            expectedRevision: materialQuotation.revision,
            lossRate: "0.1000",
          })
          .expect(200);
        materialQuotation = manualDemandUpdated.body.quotation;
        expect(
          materialQuotation.lines.find((line) => line.id === seamLine.id),
        ).toMatchObject({
          baseQuantity: "5.0000",
          lossRate: "0.1000",
          quantity: "5.5000",
        });
        for (const line of materialQuotation.lines.filter(
          (candidate) => candidate.origin === "AUTO_TILE" && !candidate.item,
        )) {
          const item = materialItems.find(
            (candidate) =>
              normalizeMaterialSpec(candidate.spec) === normalizeMaterialSpec(line.demandSpec),
          );
          if (!item) throw new Error(`找不到兼容瓷砖：${line.demandSpec}`);
          const selected = await request(realApp.getHttpServer())
            .patch(`/projects/${projectId}/main-material-quotation/lines/${line.id}`)
            .set("Cookie", cookie)
            .send({
              color: item.colors[0] ?? null,
              expectedRevision: materialQuotation.revision,
              itemVersionId: item.id,
            })
            .expect(200);
          materialQuotation = selected.body.quotation;
        }

        const first = quotations[0];
        if (!first) throw new Error("并发请求未返回报价");
        const quoted = await request(realApp.getHttpServer())
          .post(`/projects/${projectId}/half-package-quotation/submit`)
          .set("Cookie", cookie)
          .send({ expectedRevision: materialQuotation.revision })
          .expect(201)
          .expect(({ body }) => {
            expect(body.quotation).toMatchObject({
              id: first.id,
              isCurrent: true,
              status: "QUOTED",
              versionNumber: 1,
            });
          });
        const adjusted = await request(realApp.getHttpServer())
          .patch(
            `/projects/${projectId}/half-package-quotation/versions/${first.id}/adjustment`,
          )
          .set("Cookie", cookie)
          .send({
            action: "SUBMIT_FOR_APPROVAL",
            discountRate: "0.9500",
            expectedRevision: quoted.body.quotation.revision,
            reason: "客户确认九五折并抹零",
            writeOff: "1.0000",
          })
          .expect(200);
        const returned = await request(realApp.getHttpServer())
          .post(`/approvals/half-package/${first.id}/decision`)
          .set("Cookie", ownerCookie)
          .send({ action: "RETURNED", reason: "补充工程项并调整折扣" })
          .expect(201);
        await request(realApp.getHttpServer())
          .post(
            `/projects/${projectId}/half-package-quotation/versions/${returned.body.quotation.id}/continue-editing`,
          )
          .set("Cookie", cookie)
          .expect(201)
          .expect(({ body }) => {
            expect(body.quotation).toMatchObject({
              adjustedTotal: adjusted.body.quotation.adjustedTotal,
              adjustmentReason: "客户确认九五折并抹零",
              discountRate: "0.9500",
              isCurrent: true,
              status: "DRAFT",
              versionNumber: 3,
              writeOff: "1.0000",
            });
            expect(body.quotation.id).not.toBe(first.id);
          });
        await request(realApp.getHttpServer())
          .post(`/approvals/half-package/${first.id}/decision`)
          .set("Cookie", ownerCookie)
          .send({ action: "APPROVED", reason: null })
          .expect(409);
        const currentResult = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM half_package_quotations
            WHERE project_id = $1 AND is_current`,
          [projectId],
        );
        expect(currentResult.rows[0]?.count).toBe("1");
      } finally {
        if (projectId) {
          await database.query(
            `DELETE FROM half_package_approval_decisions
              WHERE quotation_id IN (
                SELECT id FROM half_package_quotations WHERE project_id = $1
              )`,
            [projectId],
          );
          await database.query(
            `DELETE FROM half_package_exports
              WHERE quotation_id IN (
                SELECT id FROM half_package_quotations WHERE project_id = $1
              )`,
            [projectId],
          );
          const versions = await database.query<{ id: string; status: string }>(
            `SELECT id, status
               FROM half_package_quotations
              WHERE project_id = $1
              ORDER BY version_number DESC`,
            [projectId],
          );
          for (const version of versions.rows) {
            if (version.status !== "DRAFT") {
              await database.query(
                `UPDATE half_package_quotations
                    SET parent_version_id = NULL,
                        status = 'DRAFT',
                        submitted_at = NULL,
                        submitted_by_user_id = NULL,
                        is_current = false
                  WHERE id = $1`,
                [version.id],
              );
            }
            await database.query(
              "DELETE FROM half_package_quotations WHERE id = $1",
              [version.id],
            );
          }
          await database.query("DELETE FROM projects WHERE id = $1", [projectId]);
        }
        await database.query(
          "DELETE FROM audit_events WHERE actor_user_id = ANY($1::uuid[])",
          [[userId, ownerId]],
        );
        await database.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
          [userId, ownerId],
        ]);
        await realApp.close();
      }
    },
    30_000,
  );
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

  async listQuoted(): Promise<readonly QuotationDraft[]> {
    return this.draft?.status === "QUOTED" &&
      this.draft.adjustmentStatus === "PENDING_APPROVAL" &&
      this.draft.isCurrent
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

  async repairDraft(input: QuotationDraft): Promise<QuotationDraft> {
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async saveAdjustment(
    _quotationId: string,
    discountRate: string,
    writeOff: string,
    adjustedTotal: string,
    grossProfit: string,
    grossMarginRate: string | null,
    actorUserId: string,
    reason: string | null,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing quotation");
    this.draft = {
      ...this.draft,
      adjustedTotal,
      adjustmentReason: reason,
      adjustmentStatus: "PENDING_APPROVAL",
      discountRate,
      grossMarginRate,
      grossProfit,
      revision: this.draft.revision + 1,
      submittedByUserId: actorUserId,
      writeOff,
    };
    return structuredClone(this.draft);
  }

  async updateMarginBenchmarkRate(
    _quotationId: string,
    marginBenchmarkRate: string,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing quotation");
    this.draft = { ...this.draft, marginBenchmarkRate };
    return structuredClone(this.draft);
  }

  async submitDraft(
    _quotationId: string,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing draft");
    this.draft = {
      ...this.draft,
      status: "QUOTED",
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
    adjustment?: ConfirmedQuotationAdjustment,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new Error("missing quotation");
    this.draft = {
      ...this.draft,
      ...(adjustment ?? {}),
      adjustmentReason: adjustment?.reason ?? this.draft.adjustmentReason,
      adjustmentStatus: action === "APPROVED" ? "CONFIRMED" : "AWAITING_SUBMISSION",
      decidedAt: new Date("2026-08-30T01:00:00Z"),
      decidedByUserId: actorUserId,
      decisionAction: action,
      decisionReason: reason,
      id: `${this.draft.id}-${action.toLowerCase()}`,
      parentVersionId: this.draft.id,
      status: action === "RETURNED" ? "RETURNED" : "APPROVED",
      versionNumber: this.draft.versionNumber + 1,
    };
    return structuredClone(this.draft!);
  }

  async continueEditing(
    source: QuotationDraft,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    const preserveAdjustment = source.status === "RETURNED";
    this.draft = {
      ...structuredClone(source),
      adjustedTotal: preserveAdjustment ? source.adjustedTotal : source.total,
      adjustmentReason: preserveAdjustment ? source.adjustmentReason : null,
      adjustmentStatus: "AWAITING_SUBMISSION",
      createdByUserId: actorUserId,
      discountRate: preserveAdjustment ? source.discountRate : "1.0000",
      id: `${source.id}-copy`,
      parentVersionId: source.id,
      status: "DRAFT",
      submittedAt: null,
      submittedByUserId: null,
      versionNumber: source.versionNumber + 1,
      writeOff: preserveAdjustment ? source.writeOff : "0.0000",
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
  createdAt: "2026-08-30T00:00:00.000Z",
  customerName: "客户",
  id: "44444444-4444-4444-8444-444444444444",
  leadDesigner: lead,
  outerFrameArea: "130.0000",
  projectAddress: "静悦府（演示）",
  quotationAmount: null,
  quotationId: null,
  quotationStatus: null,
  quotationVersion: null,
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
  updatedAt: "2026-08-30T00:00:00.000Z",
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

function bufferResponse(
  response: request.Response,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", callback);
}

function exportedQuotationSummary(
  worksheet: ExcelJS.Worksheet | undefined,
): Array<{ amount: number; label: string }> {
  const rows: Array<{ amount: number; label: string }> = [];
  worksheet?.eachRow((row) => {
    const label = row.getCell(3).text;
    if (!["直接费", "管理费", "折扣和抹零", "税金", "总造价"].includes(label)) {
      return;
    }
    rows.push({ amount: Number(row.getCell(7).value), label });
  });
  return rows;
}

async function exportedPdfSectionOrder(payload: Buffer): Promise<string[]> {
  const document = await PDFDocument.load(payload);
  const sections = document.getPages().map((page) =>
    page.node
      .get(PDFName.of("ShanyuSection"))
      ?.toString()
      .replace(/^\(|\)$/g, "") ?? "",
  );
  return sections.filter(
    (section, index) => section && section !== sections[index - 1],
  );
}

function normalizeMaterialSpec(value: string): string {
  return value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
}
