import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { ProjectDetail, SessionUser } from "@shanyu/contracts";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type {
  AuditRecord,
  AuditRepository,
} from "../src/access/audit.repository";
import { HalfPackageCalculator } from "../src/quotation/half-package-calculator";
import type {
  NewQuotationDraft,
  NewQuotationExport,
  QuotationDraft,
  QuotationDecisionAction,
  QuotationExport,
  QuotationRepository,
  QuotationTemplate,
} from "../src/quotation/quotation.repository";
import { QuotationRevisionConflictError } from "../src/quotation/quotation.repository";
import { QuotationService } from "../src/quotation/quotation.service";

describe("QuotationService", () => {
  let audits: AuditRecord[];
  let repository: InMemoryQuotationRepository;
  let service: QuotationService;

  beforeEach(() => {
    audits = [];
    repository = new InMemoryQuotationRepository();
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };
    service = new QuotationService(
      new AccessPolicy(),
      repository,
      auditRepository,
      new HalfPackageCalculator(),
    );
  });

  it("creates one draft from the published snapshot and all applicable sections", async () => {
    const quotation = await service.getOrCreateDraft(lead, project.id);

    expect(quotation).toMatchObject({
      directCost: "10582.2000",
      managementFee: "1058.2200",
      projectId: project.id,
      revision: 0,
      status: "DRAFT",
      templateVersion: 1,
      total: "11640.4200",
    });
    expect(quotation.scopes.map((scope) => scope.name)).toEqual([
      "一、砌墙工程",
      "客餐厅",
      "主卧",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
    ]);
    expect(quotation.scopes.find((scope) => scope.name === "主卧")?.lines).toMatchObject([
      {
        amount: null,
        itemName: "600*1200mm地砖（水泥砂浆粘贴）",
        quantity: null,
        quantitySource: "MANUAL",
        selected: false,
      },
      {
        amount: "846.0000",
        itemName: "顶面基层处理",
        quantity: "18.0000",
        quantitySource: "SPACE_AREA",
        selected: true,
      },
      {
        amount: "2237.2000",
        itemName: "墙面基层处理",
        quantity: "47.6000",
        quantitySource: "SPACE_PERIMETER_HEIGHT",
        selected: true,
      },
    ]);
    expect(repository.createdCount).toBe(1);
    expect(audits).toMatchObject([
      {
        action: "QUOTATION_DRAFT_CREATED",
        actorUserId: lead.id,
        targetType: "HALF_PACKAGE_QUOTATION",
      },
    ]);

    await service.getOrCreateDraft(owner, project.id);
    expect(repository.createdCount).toBe(1);
  });

  it("maps every supported space type to all of its applicable template sections", async () => {
    repository.project = {
      ...project,
      spaces: [
        space("living", "LIVING_DINING", "客餐厅", true),
        space("bedroom", "BEDROOM", "主卧"),
        space("cloakroom", "CLOSET", "衣帽间"),
        space("bathroom", "BATHROOM", "主卫"),
        space("kitchen", "KITCHEN", "厨房"),
        space("balcony", "BALCONY", "生活阳台"),
      ],
    };

    const quotation = await service.getOrCreateDraft(lead, project.id);
    const scopeCounts = new Map(
      quotation.scopes.map((scope) => [scope.name, scope.lines.length]),
    );

    expect(quotation.scopes.map((scope) => scope.name)).toEqual([
      "一、砌墙工程",
      "客餐厅",
      "主卧",
      "衣帽间",
      "主卫",
      "厨房",
      "生活阳台",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
    ]);
    expect(Object.fromEntries(scopeCounts)).toMatchObject({
      主卧: 3,
      主卫: 1,
      厨房: 1,
      客餐厅: 3,
      生活阳台: 2,
      衣帽间: 3,
    });
    expect(
      quotation.scopes
        .find((scope) => scope.name === "生活阳台")
        ?.lines.map(({ itemName, quantitySource, saleUnitPrice }) => ({
          itemName,
          quantitySource,
          saleUnitPrice,
        })),
    ).toEqual(
      quotation.scopes
        .find((scope) => scope.name === "客餐厅")
        ?.lines.filter((line) => line.itemName !== "包管道（1根）")
        .map(({ itemName, quantitySource, saleUnitPrice }) => ({
          itemName,
          quantitySource,
          saleUnitPrice,
        })),
    );
  });

  it("adds project spaces created after the draft without replacing saved quotation lines", async () => {
    const created = await service.getOrCreateDraft(lead, project.id);
    const savedLine = created.scopes[0]?.lines[0];
    if (!savedLine) {
      throw new Error("测试报价缺少待保存工程项");
    }
    const saved = await service.updateLine(lead, project.id, savedLine.id, {
      expectedRevision: created.revision,
      quantity: "2.5000",
      selected: true,
    });
    repository.project = {
      ...project,
      spaces: [
        ...project.spaces,
        space("77777777-7777-4777-8777-777777777777", "CLOSET", "衣帽间"),
        space("88888888-8888-4888-8888-888888888888", "BEDROOM", "次卧"),
      ],
    };

    const reopened = await service.getOrCreateDraft(owner, project.id);

    expect(reopened.revision).toBe(saved.revision + 1);
    expect(reopened.scopes.map((scope) => scope.name)).toEqual([
      "一、砌墙工程",
      "客餐厅",
      "主卧",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
      "衣帽间",
      "次卧",
    ]);
    expect(
      reopened.scopes
        .flatMap((scope) => scope.lines)
        .find((line) => line.id === savedLine.id),
    ).toMatchObject({
      quantity: "2.5000",
      selected: true,
    });
    expect(reopened.scopes.find((scope) => scope.name === "衣帽间")).toMatchObject({
      projectSpaceId: "77777777-7777-4777-8777-777777777777",
      spaceType: "CLOSET",
    });
    expect(reopened.scopes.find((scope) => scope.name === "衣帽间")?.lines).toHaveLength(3);
    expect(repository.createdCount).toBe(1);
    expect(repository.templateLookups).toEqual([
      [template.id, template.ruleVersionId],
    ]);
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_SCOPES_SYNCED",
      actorUserId: owner.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
  });

  it("saves a selected manual quantity and returns the server recalculated total", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const manualLine = draft.scopes
      .flatMap((scope) => scope.lines)
      .find((line) => line.itemName === "120墙体拆除");
    if (!manualLine) {
      throw new Error("测试报价缺少手工工程项");
    }

    const updated = await service.updateLine(lead, project.id, manualLine.id, {
      expectedRevision: 0,
      quantity: "2.5000",
      selected: true,
    });

    expect(updated.revision).toBe(1);
    expect(
      updated.scopes
        .flatMap((scope) => scope.lines)
        .find((line) => line.id === manualLine.id),
    ).toMatchObject({
      amount: "155.0000",
      quantity: "2.5000",
      selected: true,
    });
    expect(updated.total).toBe("11810.9200");
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_LINE_UPDATED",
      actorUserId: lead.id,
      targetId: manualLine.id,
      targetType: "HALF_PACKAGE_QUOTATION_LINE",
    });
  });

  it("does not let request data override automatic quantities or snapshot pricing", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const automaticLine = draft.scopes
      .flatMap((scope) => scope.lines)
      .find((line) => line.quantitySource === "PROJECT_BUILDING_AREA");
    if (!automaticLine) {
      throw new Error("测试报价缺少自动工程项");
    }

    await expect(
      service.updateLine(lead, project.id, automaticLine.id, {
        expectedRevision: 0,
        quantity: "1.0000",
        selected: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateLine(lead, project.id, automaticLine.id, {
        expectedRevision: 0,
        quantity: null,
        selected: true,
      }),
    ).resolves.toMatchObject({ revision: 1 });
    expect(repository.draft?.scopes.flatMap((scope) => scope.lines).find(
      (line) => line.id === automaticLine.id,
    )).toMatchObject({ saleUnitPrice: automaticLine.saleUnitPrice });
  });

  it("rejects stale saves and invalid manual quantities", async () => {
    const draft = await service.getOrCreateDraft(owner, project.id);
    const manualLine = draft.scopes[0]?.lines[0];
    if (!manualLine) {
      throw new Error("测试报价缺少手工工程项");
    }
    repository.conflictNextSave = true;

    await expect(
      service.updateLine(owner, project.id, manualLine.id, {
        expectedRevision: 0,
        quantity: "2.0000",
        selected: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateLine(owner, project.id, manualLine.id, {
        expectedRevision: 0,
        quantity: "-1",
        selected: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("denies woodwork and unrelated leads without disclosing project existence", async () => {
    await expect(
      service.getOrCreateDraft(woodwork, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getOrCreateDraft(unrelatedLead, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getOrCreateDraft({ ...woodwork, role: "FINANCE" }, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    repository.project = { ...project, leadDesigner: unrelatedLead };
    await expect(
      service.getOrCreateDraft(lead, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getOrCreateDraft({ ...woodwork, role: "PROJECT_MANAGER" }, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns snapshot cost and margin only to the owner without changing on a newer catalog", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const manualLine = draft.scopes[0]?.lines[0];
    if (!manualLine) {
      throw new Error("测试报价缺少手工工程项");
    }
    await service.updateLine(lead, project.id, manualLine.id, {
      expectedRevision: draft.revision,
      quantity: "2.5000",
      selected: true,
    });

    const costMargin = await service.getCostMargin(owner, project.id);
    expect(costMargin).toMatchObject({
      costVersion: { id: template.id, versionNumber: 1 },
      expectedCost: "10682.2000",
      grossMarginRate: "0.0051",
      grossProfit: "55.0000",
      salesAmount: "10737.2000",
    });
    expect(costMargin.scopes[0]?.lines[0]).toMatchObject({
      costAmount: "100.0000",
      costUnitPrice: "40.0000",
      grossMarginRate: "0.3548",
      grossProfit: "55.0000",
      saleAmount: "155.0000",
    });
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_COST_MARGIN_VIEWED",
      actorUserId: owner.id,
    });

    for (const actor of [lead, unrelatedLead, woodwork]) {
      await expect(service.getCostMargin(actor, project.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }

    repository.template = {
      ...template,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      items: template.items.map((item) => ({
        ...item,
        costUnitPrice: "1.0000",
      })),
      versionNumber: 2,
    };
    await expect(service.getCostMargin(owner, project.id)).resolves.toMatchObject({
      costVersion: { id: template.id, versionNumber: 1 },
      expectedCost: "10682.2000",
      grossProfit: "55.0000",
    });
  });

  it("reports missing projects and templates without creating partial drafts", async () => {
    repository.project = null;
    await expect(
      service.getOrCreateDraft(owner, project.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    repository.project = project;
    repository.template = null;
    await expect(
      service.getOrCreateDraft(owner, project.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createdCount).toBe(0);
  });

  it("checks and submits a complete draft as an immutable pending snapshot", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const check = await service.checkSubmission(lead, project.id);

    expect(check).toMatchObject({
      blockerCount: 0,
      itemCount: 11,
      sectionCount: 8,
    });
    const submitted = await service.submit(lead, project.id, draft.revision);
    expect(submitted).toMatchObject({
      status: "PENDING_APPROVAL",
      versionNumber: 1,
    });
    expect(submitted.submittedAt).not.toBeNull();
    const line = submitted.scopes[0]?.lines[0];
    if (!line) throw new Error("提交快照缺少工程项");
    await expect(
      service.updateLine(lead, project.id, line.id, {
        expectedRevision: submitted.revision,
        quantity: "1.0000",
        selected: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audits.at(-1)).toMatchObject({ action: "QUOTATION_SUBMITTED" });
  });

  it("allows only the owner to approve and exports an approved customer workbook", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    await expect(
      service.decide(lead, submitted.id, "APPROVED", null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const approved = await service.decide(
      owner,
      submitted.id,
      "APPROVED",
      null,
    );
    expect(approved.status).toBe("APPROVED");
    const exported = await service.createExport(owner, approved.id, "XLSX");
    expect(exported).toMatchObject({ format: "XLSX" });
    expect(exported.payload.subarray(0, 2).toString()).toBe("PK");
    expect(exported.sha256).toHaveLength(64);
    const customerExport = await service.getExport(lead, exported.id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      customerExport.payload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.getWorksheet("半包报价单")?.getRow(4).values).toEqual([
      undefined,
      "分区/空间",
      "工程项",
      "单位",
      "数量",
      "销售单价",
      "金额",
      "施工说明",
    ]);
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))).not.toContain("成本");
    await expect(
      service.getExport(unrelatedLead, exported.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const pdf = await service.createExport(owner, approved.id, "PDF");
    expect(pdf.payload.subarray(0, 4).toString()).toBe("%PDF");
  }, 20_000);

  it("requires a return reason and creates the next editable version", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    await expect(
      service.decide(owner, submitted.id, "RETURNED", "  "),
    ).rejects.toBeInstanceOf(BadRequestException);

    const returned = await service.decide(
      owner,
      submitted.id,
      "RETURNED",
      "补充客餐厅数量",
    );
    expect(returned.status).toBe("RETURNED");
    await expect(
      service.createExport(owner, returned.id, "PDF"),
    ).rejects.toBeInstanceOf(ConflictException);
    const nextDraft = await repository.findDraft();
    expect(nextDraft).toMatchObject({
      parentVersionId: submitted.id,
      status: "DRAFT",
      versionNumber: 2,
    });
  });

  it("requires a reason for special approval and records the decision", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    await expect(
      service.decide(owner, submitted.id, "SPECIAL_APPROVED", ""),
    ).rejects.toBeInstanceOf(BadRequestException);

    const approved = await service.decide(
      owner,
      submitted.id,
      "SPECIAL_APPROVED",
      "风险已确认",
    );
    expect(approved.status).toBe("APPROVED");
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_SPECIAL_APPROVED",
      reason: "风险已确认",
    });
  });
});

class InMemoryQuotationRepository implements QuotationRepository {
  conflictNextSave = false;
  createdCount = 0;
  draft: QuotationDraft | null = null;
  project: ProjectDetail | null = structuredClone(project);
  template: QuotationTemplate | null = structuredClone(template);
  templateLookups: [string, string][] = [];
  exports: QuotationExport[] = [];

  async findProject(): Promise<ProjectDetail | null> {
    return this.project;
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

  async findPublishedTemplate(): Promise<QuotationTemplate | null> {
    return this.template;
  }

  async findTemplate(
    templateVersionId: string,
    ruleVersionId: string,
  ): Promise<QuotationTemplate | null> {
    this.templateLookups.push([templateVersionId, ruleVersionId]);
    return this.template;
  }

  async createDraft(input: NewQuotationDraft): Promise<QuotationDraft> {
    this.createdCount += 1;
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async addDraftScopes(input: QuotationDraft): Promise<QuotationDraft> {
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async saveDraft(input: QuotationDraft): Promise<QuotationDraft> {
    if (this.conflictNextSave) {
      this.conflictNextSave = false;
      throw new QuotationRevisionConflictError();
    }
    this.draft = structuredClone(input);
    return structuredClone(input);
  }

  async submitDraft(
    _quotationId: string,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new QuotationRevisionConflictError();
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
    if (!this.draft) throw new QuotationRevisionConflictError();
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
  address: "上海市静安区测试路 1 号",
  buildingArea: "130.0000",
  customerName: "林先生",
  id: "44444444-4444-4444-8444-444444444444",
  leadDesigner: lead,
  name: "静悦府（演示）",
  spaces: [
    {
      area: "42.0000",
      displayName: "客餐厅",
      height: "2.8000",
      id: "55555555-5555-4555-8555-555555555555",
      includesBalcony: true,
      perimeter: "28.0000",
      sortOrder: 0,
      type: "LIVING_DINING",
    },
    {
      area: "18.0000",
      displayName: "主卧",
      height: "2.8000",
      id: "66666666-6666-4666-8666-666666666666",
      includesBalcony: false,
      perimeter: "17.0000",
      sortOrder: 1,
      type: "BEDROOM",
    },
  ],
};

let templateOrder = 0;

const template: QuotationTemplate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  items: [
    item("wall-1", "WALL", "120墙体拆除", "M2", "62.0000", "40.0000"),
    item("paint-1", "PAINT", "3D放样", "M2", "12.0000"),
    item("electrical-1", "ELECTRICAL", "开管线槽", "M2", "15.5000"),
    item("other-1", "OTHER", "装潢垃圾清理费", "M2", "15.0000"),
    item(
      "living-1",
      "LIVING_DINING",
      "600*1200mm地砖（水泥砂浆粘贴）",
      "M2",
      "160.0000",
    ),
    item("living-2", "LIVING_DINING", "顶面基层处理", "M2", "47.0000"),
    item("balcony-1", "BALCONY", "包管道（1根）", "项", "280.0000"),
    item("kitchen-bathroom-1", "KITCHEN_BATHROOM", "厨卫门槛石安装", "M", "120.0000"),
    item(
      "bedroom-1",
      "BEDROOM",
      "600*1200mm地砖（水泥砂浆粘贴）",
      "M2",
      "160.0000",
    ),
    item("bedroom-2", "BEDROOM", "顶面基层处理", "M2", "47.0000"),
    item("bedroom-3", "BEDROOM", "墙面基层处理", "M2", "47.0000"),
  ],
  ruleVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  versionNumber: 1,
};

function space(
  id: string,
  type: ProjectDetail["spaces"][number]["type"],
  displayName: string,
  includesBalcony = false,
): ProjectDetail["spaces"][number] {
  return {
    area: "10.0000",
    displayName,
    height: "2.8000",
    id,
    includesBalcony,
    perimeter: "12.0000",
    sortOrder: 0,
    type,
  };
}

function item(
  id: string,
  sectionCode: QuotationTemplate["items"][number]["sectionCode"],
  itemName: string,
  unit: string,
  saleUnitPrice: string,
  costUnitPrice = saleUnitPrice,
): QuotationTemplate["items"][number] {
  return {
    costUnitPrice,
    id,
    itemName,
    remarks: null,
    saleUnitPrice,
    sectionCode,
    sectionName: sectionName(sectionCode),
    sortOrder: templateOrder++,
    unit,
  };
}

function sectionName(
  sectionCode: QuotationTemplate["items"][number]["sectionCode"],
): string {
  return {
    BALCONY: "七、阳台工程",
    BEDROOM: "三、卧室工程",
    ELECTRICAL: "十一、水电工程",
    KITCHEN_BATHROOM: "八、厨卫工程",
    LIVING_DINING: "二、客餐厅工程",
    OTHER: "十二、其他工程",
    PAINT: "十、油漆工程",
    WALL: "一、砌墙工程",
  }[sectionCode];
}
