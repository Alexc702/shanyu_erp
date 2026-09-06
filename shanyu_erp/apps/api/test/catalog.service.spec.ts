import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type {
  AuditRecord,
  AuditRepository,
} from "../src/access/audit.repository";
import type {
  CatalogImportBatch,
  CatalogRepository,
  NewCatalogImportBatch,
  PublishedHalfPackageCatalog,
} from "../src/catalog/catalog.repository";
import { CatalogService } from "../src/catalog/catalog.service";

describe("CatalogService", () => {
  let audits: AuditRecord[];
  let repository: InMemoryCatalogRepository;
  let service: CatalogService;

  beforeEach(() => {
    audits = [];
    repository = new InMemoryCatalogRepository();
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };
    service = new CatalogService(
      new AccessPolicy(),
      repository,
      auditRepository,
    );
  });

  it("reuses the validated batch when the same workbook hash is uploaded again", async () => {
    const buffer = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
    );

    const first = await service.validateWorkbook(owner, {
      buffer,
      fileName: "半包报价单_v5.xlsx",
    });
    const second = await service.validateWorkbook(owner, {
      buffer,
      fileName: "重复上传.xlsx",
    });

    expect(first).toMatchObject({
      reused: false,
      status: "VALIDATED",
      validation: { blockerCount: 0, itemCount: 178 },
    });
    expect(second).toMatchObject({ id: first.id, reused: true });
    expect(repository.createdBatchCount).toBe(1);
    expect(audits).toMatchObject([
      {
        action: "CATALOG_IMPORT_VALIDATED",
        actorUserId: owner.id,
        targetId: first.id,
        targetType: "CATALOG_IMPORT_BATCH",
      },
      {
        action: "CATALOG_IMPORT_REUSED",
        actorUserId: owner.id,
        targetId: first.id,
        targetType: "CATALOG_IMPORT_BATCH",
      },
    ]);
  });

  it("publishes a validated batch once as an immutable catalog version", async () => {
    const buffer = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
    );
    const batch = await service.validateWorkbook(owner, {
      buffer,
      fileName: "半包报价单_v5.xlsx",
    });

    const published = await service.publishBatch(owner, batch.id);

    expect(published).toMatchObject({
      items: { length: 178 },
      sections: { length: 8 },
      versionNumber: 1,
    });
    await expect(service.publishBatch(owner, batch.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(audits.at(-1)).toMatchObject({
      action: "CATALOG_VERSION_PUBLISHED",
      actorUserId: owner.id,
      targetId: published.id,
      targetType: "HALF_PACKAGE_TEMPLATE_VERSION",
    });
  });

  it("persists blocking differences as a failed batch that cannot publish", async () => {
    const source = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      source as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("半包报价模板");
    if (!sheet) {
      throw new Error("测试源文件缺少半包报价模板");
    }
    sheet.getCell("J27").value = null;
    const serialized = await workbook.xlsx.writeBuffer();

    const batch = await service.validateWorkbook(owner, {
      buffer: Buffer.from(serialized as unknown as Uint8Array),
      fileName: "成本价缺失.xlsx",
    });

    expect(batch).toMatchObject({
      status: "FAILED",
      validation: {
        blockerCount: 1,
        blockers: ["Excel 第 27 行缺少销售价或成本价"],
        costPriceCount: 177,
      },
    });
    await expect(service.publishBatch(owner, batch.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("rejects unreadable files without creating an import batch", async () => {
    await expect(
      service.validateWorkbook(owner, {
        buffer: Buffer.from("这不是 Excel"),
        fileName: "错误.xlsx",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createdBatchCount).toBe(0);
  });

  it("denies every non-owner role from importing a workbook", async () => {
    for (const actor of [lead, woodwork, projectManager, finance]) {
      await expect(
        service.validateWorkbook(actor, {
          buffer: Buffer.alloc(0),
          fileName: "forbidden.xlsx",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(repository.createdBatchCount).toBe(0);
  });

  it("returns costs to administrators and owners and denies unrelated roles", async () => {
    const buffer = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
    );
    const batch = await service.validateWorkbook(owner, {
      buffer,
      fileName: "半包报价单_v5.xlsx",
    });
    await service.publishBatch(owner, batch.id);

    const ownerView = await service.getPublishedCatalog(owner);
    const administratorView = await service.getPublishedCatalog(administrator);
    const leadView = await service.getPublishedCatalog(lead);

    expect(ownerView.items[0]).toHaveProperty("costUnitPrice");
    expect(administratorView.items[0]).toHaveProperty("costUnitPrice");
    expect(leadView.items[0]).not.toHaveProperty("costUnitPrice");
    await expect(service.getPublishedCatalog(woodwork)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.getPublishedCatalog(projectManager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getPublishedCatalog(finance)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

class InMemoryCatalogRepository implements CatalogRepository {
  private readonly batches: CatalogImportBatch[] = [];
  private publishedCatalog: PublishedHalfPackageCatalog | null = null;
  createdBatchCount = 0;

  async findImportBatchByHash(fileHash: string): Promise<CatalogImportBatch | null> {
    return this.batches.find((batch) => batch.fileHash === fileHash) ?? null;
  }

  async createImportBatch(input: NewCatalogImportBatch): Promise<CatalogImportBatch> {
    this.createdBatchCount += 1;
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
      items: batch.items.map((item, index) => ({
        ...item,
        id: `item-${index + 1}`,
      })),
      publishedAt: new Date("2026-08-28T01:00:00.000Z"),
      sections: batch.sections.map((section, index) => ({
        ...section,
        id: `section-${index + 1}`,
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

const administrator: SessionUser = {
  account: "admin",
  displayName: "系统管理员",
  id: "00000000-0000-4000-8000-000000000001",
  phone: null,
  role: "ADMIN",
};

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

const woodwork: SessionUser = {
  account: "mori",
  displayName: "木作设计师",
  id: "33333333-3333-4333-8333-333333333334",
  phone: null,
  role: "WOODWORK_DESIGNER",
};

const projectManager: SessionUser = {
  account: "manager",
  displayName: "项目经理",
  id: "44444444-4444-4444-8444-444444444445",
  phone: null,
  role: "PROJECT_MANAGER",
};

const finance: SessionUser = {
  account: "finance",
  displayName: "财务",
  id: "55555555-5555-4555-8555-555555555556",
  phone: null,
  role: "FINANCE",
};
