import { ForbiddenException } from "@nestjs/common";
import type { ProjectDetail, SessionUser } from "@shanyu/contracts";
import { describe, expect, it, vi } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type { AuditRepository } from "../src/access/audit.repository";
import type { ProjectsRepository } from "../src/project/projects.repository";
import type {
  MainMaterialCatalog,
  MainMaterialImportBatch,
  MainMaterialQuotation,
  MainMaterialRepository,
} from "../src/main-material/main-material.repository";
import { MainMaterialService } from "../src/main-material/main-material.service";

describe("MainMaterialService", () => {
  it("filters pending items and all costs for a lead designer", async () => {
    const service = createService();
    const view = await service.getPublishedCatalog(lead);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).not.toHaveProperty("costPrice");
    expect(view.items[0]).not.toHaveProperty("priceDerivation");
    expect(view.items[0]).not.toHaveProperty("sourceFile");
    expect(view.items[0]?.remarks).toBe("");
    expect(view.items[0]?.materialId).toBe("MAT-TILE-ACTIVE");
  });

  it("returns item and quotation costs to the owner with decimal-safe margin values", async () => {
    const service = createService();
    const catalogView = await service.getPublishedCatalog(owner);
    expect(catalogView.items).toHaveLength(2);
    expect(catalogView.items[0]?.costPrice).toBe("0.10");
    const quotationView = await service.getQuotation(owner, project.id);
    expect(quotationView.summary).toMatchObject({
      expectedCost: "0.1000",
      grossMarginRate: "0.6667",
      grossProfit: "0.2000",
      total: "0.3000",
    });
    expect(quotationView.lines[0]?.item?.costUnitPrice).toBe("0.10");
  });

  it("creates a validated online-edit batch for the owner and rejects the lead", async () => {
    const repository = createRepository();
    const service = createService(repository);
    const input = {
      changeReason: "补齐型号信息",
      expectedRecordVersion: 1,
      materialId: "MAT-TILE-ACTIVE",
      operation: "UPSERT" as const,
      values: { model: "TI0T-REV" },
    };
    const batch = await service.validateOnlineEdit(owner, input);
    expect(batch).toMatchObject({ mode: "DELTA", status: "VALIDATED" });
    expect(repository.validateDelta).toHaveBeenCalledWith([
      expect.objectContaining({ materialId: "MAT-TILE-ACTIVE", values: { model: "TI0T-REV" } }),
    ]);
    await expect(service.validateOnlineEdit(lead, input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("shows selected-item differences before explicitly refreshing a draft catalog", async () => {
    const repository = createRepository();
    const latestItem = {
      ...item,
      catalogVersionId: "catalog-v2",
      costPrice: "0.20",
      id: "item-v2",
      model: "TI0T-REV",
      salePrice: "0.40",
    };
    repository.getPublishedCatalog.mockResolvedValue({
      id: "catalog-v2",
      items: [latestItem],
      name: "山屿 ERP 主材库 V2",
      publishedAt: new Date("2026-09-09T00:00:00Z"),
      versionNumber: 2,
    });
    const service = createService(repository);
    const checked = await service.checkCatalogUpdate(owner, project.id);
    expect(checked).toMatchObject({
      currentVersionNumber: 1,
      latestVersionNumber: 2,
      updateAvailable: true,
    });
    expect(checked.differences[0]).toMatchObject({
      materialId: item.materialId,
      status: "UPDATED",
    });
    expect(checked.differences[0]?.fields.map((field) => field.label)).toEqual(
      expect.arrayContaining(["型号", "销售价", "成本价"]),
    );

    const refreshed = { ...quotation, catalog: { id: "catalog-v2", name: "山屿 ERP 主材库 V2", versionNumber: 2 }, revision: 2 };
    repository.refreshDraftCatalog.mockResolvedValue(refreshed);
    const result = await service.refreshCatalog(owner, project.id, quotation.revision);
    expect(repository.refreshDraftCatalog).toHaveBeenCalledWith({
      expectedRevision: quotation.revision,
      projectId: project.id,
    });
    expect(result).toMatchObject({ revision: 2, catalogVersion: { versionNumber: 2 } });
  });
});

function createService(repository = createRepository()) {
  const projectsRepository = {
    async findById(projectId: string) {
      return projectId === project.id ? project : null;
    },
  } as unknown as ProjectsRepository;
  const auditRepository = { append: vi.fn(async () => undefined) } satisfies AuditRepository;
  return new MainMaterialService(new AccessPolicy(), repository, projectsRepository, auditRepository);
}

function createRepository() {
  const batch: MainMaterialImportBatch = {
    createdAt: new Date("2026-09-08T00:00:00Z"),
    createdByUserId: owner.id,
    fileHash: "a".repeat(64),
    fileName: "线上维护-MAT-TILE-ACTIVE",
    id: "batch",
    mode: "DELTA",
    payload: [],
    publishedVersionId: null,
    status: "VALIDATED",
    validation: { blockerCount: 0, blockers: [], itemCount: 1, pendingItemCount: 1, warningCount: 0, warnings: [] },
  };
  return {
    createImportBatch: vi.fn(async (input) => ({ ...batch, ...input })),
    findImportBatchByHash: vi.fn(async () => null),
    getPublishedCatalog: vi.fn(async () => catalog),
    getQuotationByProject: vi.fn(async () => quotation),
    initializeAndSyncDraft: vi.fn(async () => quotation),
    refreshDraftCatalog: vi.fn(async () => quotation),
    validateDelta: vi.fn(async () => ({ pendingItemCount: 1 })),
  } as unknown as MainMaterialRepository & {
    createImportBatch: ReturnType<typeof vi.fn>;
    findImportBatchByHash: ReturnType<typeof vi.fn>;
    getPublishedCatalog: ReturnType<typeof vi.fn>;
    getQuotationByProject: ReturnType<typeof vi.fn>;
    initializeAndSyncDraft: ReturnType<typeof vi.fn>;
    refreshDraftCatalog: ReturnType<typeof vi.fn>;
    validateDelta: ReturnType<typeof vi.fn>;
  };
}

const item = {
  assetIds: [], attributes: {}, brand: "HBI", catalogVersionId: "catalog",
  categoryCode: "TILE" as const, categoryName: "瓷砖", colors: [], costPrice: "0.10",
  id: "item", itemName: "瓷砖", materialId: "MAT-TILE-ACTIVE", missingFields: "",
  model: "TI0T", recordVersion: 1, remarks: "", salePrice: "0.30", series: "",
  spec: "750*1500", status: "ACTIVE" as const, unit: "M2",
};

const catalog: MainMaterialCatalog = {
  id: "catalog",
  items: [item, { ...item, id: "pending", materialId: "MAT-PENDING", status: "PENDING_DATA" }],
  name: "山屿 ERP 主材库 V1",
  publishedAt: new Date("2026-09-08T00:00:00Z"),
  versionNumber: 1,
};

const quotation: MainMaterialQuotation = {
  catalog: { id: catalog.id, name: catalog.name, versionNumber: 1 },
  directCost: "0.3000", expectedCost: "0.1000", id: "quotation",
  lines: [{
    assetIds: [], baseQuantity: "1.0000", brand: item.brand, categoryCode: "TILE",
    colors: [], costAmount: "0.1000", costUnitPrice: "0.10", demandName: "主卧地砖",
    demandSpec: item.spec, id: "line", itemName: item.itemName, itemVersionId: item.id,
    lossRate: "0.1500", materialId: item.materialId, model: item.model, origin: "AUTO_TILE",
    quantity: "1.0000", saleAmount: "0.3000", saleUnitPrice: "0.30", scopeName: "主卧",
    selectedColor: null, series: item.series, spec: item.spec, unit: item.unit,
  }],
  managementFee: "0.0000", projectId: "project", revision: 1, status: "DRAFT", total: "0.3000",
};

const owner: SessionUser = { account: "owner", displayName: "老板", id: "owner", phone: "13800000000", role: "OWNER" };
const lead: SessionUser = { account: "lead", displayName: "主案", id: "lead", phone: "13900000000", role: "LEAD_DESIGNER" };
const project = {
  createdAt: "2026-09-08T00:00:00Z", customerName: "陆女士", id: "project",
  leadDesigner: { account: lead.account, displayName: lead.displayName, id: lead.id, phone: lead.phone, role: lead.role },
  outerFrameArea: "130.0000", projectAddress: "示例项目", quotationAmount: null,
  quotationId: null, quotationStatus: null, quotationVersion: null, spaces: [],
  updatedAt: "2026-09-08T00:00:00Z",
} satisfies ProjectDetail;
