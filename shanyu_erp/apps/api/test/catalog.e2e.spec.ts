import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { SessionUser } from "@shanyu/contracts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import {
  CATALOG_REPOSITORY,
  type CatalogImportBatch,
  type CatalogRepository,
  type NewCatalogImportBatch,
  type PublishedHalfPackageCatalog,
} from "../src/catalog/catalog.repository";
import { CatalogController } from "../src/catalog/catalog.controller";
import { CatalogService } from "../src/catalog/catalog.service";

describe("half-package catalog HTTP interface", () => {
  let app: INestApplication;
  let audits: AuditRecord[];

  beforeEach(async () => {
    const users = [
      await storedUser("owner-id", "owner", "OWNER", "owner-password"),
      await storedUser("lead-id", "alex", "LEAD_DESIGNER", "lead-password"),
      await storedUser(
        "woodwork-id",
        "mori",
        "WOODWORK_DESIGNER",
        "woodwork-password",
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
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, CatalogController],
      providers: [
        AccessPolicy,
        AuthService,
        CatalogService,
        { provide: AUTH_REPOSITORY, useValue: authRepository },
        { provide: AUDIT_REPOSITORY, useValue: auditRepository },
        { provide: CATALOG_REPOSITORY, useClass: InMemoryCatalogRepository },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets the owner validate and publish the 157-item workbook", async () => {
    const cookie = await login("owner", "owner-password");
    const workbook = await readFile(sourceWorkbookPath);

    const imported = await request(app.getHttpServer())
      .post("/catalog/half-package/imports")
      .set("Cookie", cookie)
      .attach("file", workbook, "半包报价单_v2.xlsx")
      .expect(201);

    expect(imported.body.batch).toMatchObject({
      reused: false,
      status: "VALIDATED",
      validation: {
        blockerCount: 0,
        itemCount: 157,
        sectionCount: 8,
        warningSourceRows: [56, 101, 163],
      },
    });
    expect(imported.body.batch).not.toHaveProperty("items");

    const published = await request(app.getHttpServer())
      .post(`/catalog/half-package/imports/${imported.body.batch.id}/publish`)
      .set("Cookie", cookie)
      .expect(201);

    expect(published.body.catalog).toMatchObject({
      versionNumber: 1,
      items: { length: 157 },
      sections: { length: 8 },
    });
    expect(published.body.catalog.items[0]).toHaveProperty("costUnitPrice");
    expect(audits.at(-1)?.action).toBe("CATALOG_VERSION_PUBLISHED");
  });

  it("lets the lead read sale prices but never import or receive costs", async () => {
    const ownerCookie = await login("owner", "owner-password");
    const workbook = await readFile(sourceWorkbookPath);
    const imported = await request(app.getHttpServer())
      .post("/catalog/half-package/imports")
      .set("Cookie", ownerCookie)
      .attach("file", workbook, "半包报价单_v2.xlsx")
      .expect(201);
    await request(app.getHttpServer())
      .post(`/catalog/half-package/imports/${imported.body.batch.id}/publish`)
      .set("Cookie", ownerCookie)
      .expect(201);

    const leadCookie = await login("alex", "lead-password");
    await request(app.getHttpServer())
      .post("/catalog/half-package/imports")
      .set("Cookie", leadCookie)
      .attach("file", workbook, "半包报价单_v2.xlsx")
      .expect(403);

    const response = await request(app.getHttpServer())
      .get("/catalog/half-package/published")
      .set("Cookie", leadCookie)
      .expect(200);

    expect(response.body.catalog.items).toHaveLength(157);
    expect(JSON.stringify(response.body)).not.toContain("costUnitPrice");
    expect(response.body.catalog.items[0]).toHaveProperty("saleUnitPrice");
  });

  it("denies the woodwork role access to the half-package catalog", async () => {
    const cookie = await login("mori", "woodwork-password");

    await request(app.getHttpServer())
      .get("/catalog/half-package/published")
      .set("Cookie", cookie)
      .expect(403);
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

class InMemoryCatalogRepository implements CatalogRepository {
  private readonly batches: CatalogImportBatch[] = [];
  private publishedCatalog: PublishedHalfPackageCatalog | null = null;

  async findImportBatchByHash(fileHash: string): Promise<CatalogImportBatch | null> {
    return this.batches.find((batch) => batch.fileHash === fileHash) ?? null;
  }

  async createImportBatch(input: NewCatalogImportBatch): Promise<CatalogImportBatch> {
    const batch: CatalogImportBatch = {
      ...input,
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      publishedVersionId: null,
    };
    this.batches.push(batch);
    return batch;
  }

  async findImportBatchById(batchId: string): Promise<CatalogImportBatch | null> {
    return this.batches.find((batch) => batch.id === batchId) ?? null;
  }

  async publishImportBatch(
    batchId: string,
  ): Promise<PublishedHalfPackageCatalog> {
    const index = this.batches.findIndex((batch) => batch.id === batchId);
    const batch = this.batches[index];
    if (!batch) {
      throw new Error("批次不存在");
    }
    this.publishedCatalog = {
      id: "33333333-3333-4333-8333-333333333333",
      items: batch.items.map((item, itemIndex) => ({
        ...item,
        id: `item-${itemIndex + 1}`,
      })),
      publishedAt: new Date("2026-08-28T01:00:00.000Z"),
      sections: batch.sections.map((section, sectionIndex) => ({
        ...section,
        id: `section-${sectionIndex + 1}`,
      })),
      versionNumber: 1,
    };
    this.batches[index] = {
      ...batch,
      publishedVersionId: this.publishedCatalog.id,
      status: "PUBLISHED",
    };
    return this.publishedCatalog;
  }

  async getPublishedCatalog(): Promise<PublishedHalfPackageCatalog | null> {
    return this.publishedCatalog;
  }
}

const sourceWorkbookPath = resolve(
  process.cwd(),
  "../../../半包报价单_v2.xlsx",
);

async function storedUser(
  id: string,
  account: string,
  role: SessionUser["role"],
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
