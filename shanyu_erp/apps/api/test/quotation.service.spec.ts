import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type {
  HalfPackageApprovalDecision,
  ProjectDetail,
  SessionUser,
} from "@shanyu/contracts";
import ExcelJS from "exceljs";
import { PDFDocument, PDFName } from "pdf-lib";
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
      directCost: "20182.2000",
      managementFee: "2018.2200",
      projectId: project.id,
      revision: 0,
      status: "DRAFT",
      templateVersion: 1,
      total: "22200.4200",
    });
    expect(quotation.scopes.map((scope) => scope.name)).toEqual([
      "一、砌墙工程",
      "客餐厅（包阳台）",
      "主卧",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
      "管理费",
    ]);
    expect(quotation.scopes.find((scope) => scope.name === "主卧")?.lines).toMatchObject([
      {
        amount: "2880.0000",
        itemName: "600*1200mm地砖（水泥砂浆粘贴）",
        quantity: "18.0000",
        quantitySource: "SPACE_AREA",
        selected: true,
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

  it("returns the same draft when its first requests arrive concurrently", async () => {
    const [leadResult, ownerResult] = await Promise.all([
      service.getOrCreateDraft(lead, project.id),
      service.getOrCreateDraft(owner, project.id),
    ]);

    expect(ownerResult.id).toBe(leadResult.id);
    expect(ownerResult.scopes).toEqual(leadResult.scopes);
    expect(ownerResult.scopes).not.toHaveLength(0);
    expect(repository.createdCount).toBe(1);
    expect(audits).toHaveLength(1);
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
      "客餐厅（包阳台）",
      "主卧",
      "衣帽间",
      "主卫",
      "厨房",
      "生活阳台",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
      "管理费",
    ]);
    expect(Object.fromEntries(scopeCounts)).toMatchObject({
      主卧: 3,
      主卫: 1,
      厨房: 1,
      "客餐厅（包阳台）": 3,
      生活阳台: 1,
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
        .find((scope) => scope.name === "客餐厅（包阳台）")
        ?.lines.filter((line) => line.sectionName === "七、阳台工程")
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
      "客餐厅（包阳台）",
      "主卧",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
      "衣帽间",
      "次卧",
      "管理费",
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
    expect(updated.total).toBe("22370.9200");
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
      .find((line) => line.quantitySource === "PROJECT_OUTER_FRAME_AREA");
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
      expectedCost: "20282.2000",
      grossMarginRate: "0.0934",
      grossProfit: "2088.7200",
      salesAmount: "22370.9200",
    });
    expect(costMargin.scopes[0]?.lines[0]).toMatchObject({
      costAmount: "100.0000",
      costUnitPrice: "40.0000",
      grossMarginRate: "0.3548",
      grossProfit: "55.0000",
      saleAmount: "155.0000",
    });
    expect(audits.some((audit) => audit.action === "QUOTATION_COST_MARGIN_VIEWED")).toBe(false);

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
      expectedCost: "20282.2000",
      grossProfit: "2088.7200",
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

  it("checks and confirms a complete draft as an immutable quoted snapshot", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const check = await service.checkSubmission(lead, project.id);

    expect(check).toMatchObject({
      blockerCount: 0,
      itemCount: 11,
      sectionCount: 8,
    });
    const submitted = await service.submit(lead, project.id, draft.revision);
    expect(submitted).toMatchObject({
      status: "QUOTED",
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
    expect(audits.at(-1)).toMatchObject({ action: "QUOTATION_GENERATED" });
  });

  it("lists pending approvals with the current business margin snapshot", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const quoted = await service.submit(lead, project.id, draft.revision);
    await expect(service.listPendingApprovals(owner)).resolves.toEqual([]);
    await service.updateAdjustment(lead, quoted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "1.0000",
      expectedRevision: quoted.revision,
      reason: "客户确认不调整",
      writeOff: "0.0000",
    });

    await expect(service.listPendingApprovals(owner)).resolves.toEqual([
      expect.objectContaining({
        expectedCost: "20182.2000",
        grossMarginRate: "0.0909",
        grossProfit: "2018.2200",
        salesAmount: "22200.4200",
        thirdPartyPurchaseAmount: null,
      }),
    ]);
  });

  it("submits a lead adjustment for approval and lets the owner confirm directly", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const quoted = await service.submit(lead, project.id, draft.revision);
    const quotedSnapshot = structuredClone(repository.draft);

    const leadAdjusted = await service.updateAdjustment(lead, quoted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "0.9500",
      expectedRevision: quoted.revision,
      reason: "客户确认九五折并抹零",
      writeOff: "100.0000",
    });
    expect(leadAdjusted).toMatchObject({
      adjustedTotal: "20990.3990",
      adjustmentStatus: "PENDING_APPROVAL",
      discountRate: "0.9500",
      revision: 1,
      writeOff: "100.0000",
    });
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_ADJUSTMENT_SUBMITTED",
      actorUserId: lead.id,
      afterState: { discountRate: "0.9500", writeOff: "100.0000" },
      beforeState: { discountRate: "1.0000", writeOff: "0.0000" },
      reason: "客户确认九五折并抹零",
    });

    await expect(
      service.updateAdjustment(unrelatedLead, quoted.id, {
        action: "SUBMIT_FOR_APPROVAL",
        discountRate: "0.9800",
        expectedRevision: leadAdjusted.revision,
        reason: "无权调整",
        writeOff: "0.0000",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const nextDraft = await service.continueEditing(lead, leadAdjusted.id).catch(
      (error: unknown) => error,
    );
    expect(nextDraft).toBeInstanceOf(ConflictException);

    repository.draft = quotedSnapshot;
    const ownerConfirmed = await service.updateAdjustment(owner, quoted.id, {
        action: "CONFIRM",
        discountRate: "0.9800",
        expectedRevision: quoted.revision,
        reason: "老板确认九八折并抹零",
        writeOff: "20.0000",
      });
    expect(ownerConfirmed).toMatchObject({
      adjustmentStatus: "CONFIRMED",
      adjustedTotal: "21736.4116",
      status: "APPROVED",
    });
    expect(audits.at(-1)).toMatchObject({
      action: "QUOTATION_ADJUSTMENT_CONFIRMED",
      actorUserId: owner.id,
    });
  });

  it("exports an undiscounted quote and blocks pending export", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    await expect(
      service.decide(lead, submitted.id, "APPROVED", null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const quotedXlsx = await service.createExport(lead, submitted.id, "XLSX");
    const quotedWorkbook = new ExcelJS.Workbook();
    await quotedWorkbook.xlsx.load(
      quotedXlsx.payload as unknown as Parameters<typeof quotedWorkbook.xlsx.load>[0],
    );
    expect(quotedWorkbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "封面",
      "预算说明书",
      "半包报价单",
      "主材报价单",
    ]);
    expect(quotationSummaryRows(quotedWorkbook.getWorksheet("半包报价单")))
      .toEqual([
        { amount: 20182.2, label: "直接费", number: "（1）" },
        { amount: 2018.22, label: "管理费", number: "（2）" },
        { amount: 1332.03, label: "税金", number: "（3）" },
        { amount: 23532.45, label: "总造价", number: "（4）" },
      ]);
    const quotedHalfPackage = quotedWorkbook.getWorksheet("半包报价单");
    const quotedManagementRow = quotationSummaryRowNumber(
      quotedHalfPackage,
      "管理费",
    );
    const quotedTaxRow = quotationSummaryRowNumber(quotedHalfPackage, "税金");
    const quotedTotalRow = quotationSummaryRowNumber(quotedHalfPackage, "总造价");
    expect(quotationSummaryRowNumber(quotedHalfPackage, "折扣和抹零")).toBe(0);
    expect(quotedTaxRow).toBe(quotedManagementRow + 1);
    expect(quotedTotalRow).toBe(quotedTaxRow + 1);
    expect(quotedHalfPackage?.getRow(quotedTaxRow).hidden).toBe(false);

    const initialExport = await service.createExport(lead, submitted.id, "PDF");
    expect(initialExport).toMatchObject({ format: "PDF" });
    expect(initialExport.payload.subarray(0, 4).toString()).toBe("%PDF");
    expect(await pdfSectionOrder(initialExport.payload)).toEqual([
      "COVER",
      "BUDGET",
      "HALF",
      "MAIN",
    ]);
    const pending = await service.updateAdjustment(lead, submitted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "1.0000",
      expectedRevision: submitted.revision,
      reason: "客户确认不调整",
      writeOff: "0.0000",
    });
    await expect(
      service.createExport(lead, pending.id, "PDF"),
    ).rejects.toBeInstanceOf(ConflictException);

    const approved = await service.decide(
      owner,
      pending.id,
      "APPROVED",
      null,
    );
    expect(approved.status).toBe("APPROVED");
    const exported = quotedXlsx;
    expect(exported).toMatchObject({ format: "XLSX" });
    expect(exported.payload.subarray(0, 2).toString()).toBe("PK");
    expect(exported.sha256).toHaveLength(64);
    const customerExport = await service.getExport(lead, exported.id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      customerExport.payload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "封面",
      "预算说明书",
      "半包报价单",
      "主材报价单",
    ]);
    const cover = workbook.getWorksheet("封面");
    expect(cover?.getCell("A4").text).toContain(project.projectAddress);
    expect(cover?.getCell("A4").text).not.toContain("金地天元鸣望-8-2-602");
    expect(cover?.getImages()).toHaveLength(1);
    expect(cover?.getCell("D4").master.address).toBe("A4");
    expect(cover?.getRow(1).height).toBe(408);
    expect([cover?.getColumn(1).width, cover?.getColumn(4).width]).toEqual([
      112.625,
      17.9134615384615,
    ]);
    expect(cover?.pageSetup.printArea).toBe("A1:D7");
    expect(cover?.pageSetup.orientation).toBe("landscape");
    expect([
      cover?.pageSetup.fitToPage,
      cover?.pageSetup.fitToWidth,
      cover?.pageSetup.fitToHeight,
    ]).toEqual([true, 1, 1]);
    const budget = workbook.getWorksheet("预算说明书");
    expect(budget?.getCell("B18").text).toContain("本报价未包含税金。");
    expect(budget?.getCell("B2").master.address).toBe("A2");
    expect(budget?.getRow(14).height).toBe(68);
    expect(budget?.getColumn(2).width).toBe(151.576923076923);
    expect(budget?.pageSetup.printArea).toBe("A1:B19");
    expect([
      budget?.pageSetup.fitToPage,
      budget?.pageSetup.fitToWidth,
      budget?.pageSetup.fitToHeight,
    ]).toEqual([true, 1, 1]);
    const worksheet = workbook.getWorksheet("半包报价单");
    expect(worksheet?.getCell("A1").value).toBe("基础报价明细表");
    expect(worksheet?.getCell("C2").value).toBe(project.customerName);
    expect(worksheet?.getCell("B4").master.address).toBe("A3");
    expect(worksheet?.getCell("D4").master.address).toBe("C3");
    expect(worksheet?.getCell("E4").master.address).toBe("E3");
    expect(worksheet?.getCell("F4").master.address).toBe("F3");
    expect(worksheet?.getCell("H3").master.address).toBe("G3");
    expect(worksheet?.getCell("I4").master.address).toBe("I3");
    expect(["A3", "C3", "E3", "F3", "G3", "I3"].map(
      (address) => worksheet?.getCell(address).value,
    )).toEqual(["编号", "工程项目", "单位", "数量", "工 程 造 价", "备       注"]);
    expect(worksheet?.getCell("C3").border.top?.style).toBe("thin");
    expect(worksheet?.getCell("D3").border.right?.style).toBe("thin");
    expect(worksheet?.getCell("C4").border.bottom?.style).toBe("thin");
    expect(worksheet?.getCell("D4").border.bottom?.style).toBe("thin");
    expect(worksheet?.getCell("A6").border.left?.style).toBe("medium");
    expect(worksheet?.getCell("B6").border.right?.style).toBe("thin");
    expect(worksheet?.getCell("A6").border.bottom?.style).toBe("thin");
    expect(worksheet?.getCell("B6").border.bottom?.style).toBe("thin");
    expect(worksheet?.getCell("E6").value).toBe("M²");
    expect(worksheet?.getCell("I6").value).toBe(
      "1、人工费；\n2、垃圾装袋运至小区指定点，如需要运到小区外费用另计。",
    );
    expect(worksheet?.getCell("I6").alignment.wrapText).toBe(true);
    expect(worksheet?.getRow(6).height).toBeGreaterThanOrEqual(31);
    expect(worksheet?.getRow(1).height).toBe(50);
    expect(worksheet?.getRow(2).height).toBe(30);
    expect(
      Array.from({ length: 9 }, (_, index) => worksheet?.getColumn(index + 1).width),
    ).toEqual([
      5.625,
      5.625,
      20.625,
      20.7788461538462,
      12.625,
      12.625,
      12.625,
      12.625,
      55.625,
    ]);
    expect(worksheet?.getImages()).toHaveLength(1);
    expect(worksheet?.pageSetup.printArea).toMatch(/^A1:I\d+$/);
    expect(quotationSummaryRows(worksheet)).toEqual([
      { amount: 20182.2, label: "直接费", number: "（1）" },
      { amount: 2018.22, label: "管理费", number: "（2）" },
      { amount: 1332.03, label: "税金", number: "（3）" },
      { amount: 23532.45, label: "总造价", number: "（4）" },
    ]);
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))).not.toContain("成本");
    expect(workbookFormulaCells(workbook)).toEqual([]);
    await expect(
      service.getExport(unrelatedLead, exported.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  it.each([
    {
      discountRate: "0.9500",
      expected: [
        { amount: 20182.2, label: "直接费", number: "（1）" },
        { amount: 2018.22, label: "管理费", number: "（2）" },
        { amount: -1110.02, label: "折扣和抹零", number: "（3）" },
        { amount: 1265.42, label: "税金", number: "（4）" },
        { amount: 22355.82, label: "总造价", number: "（5）" },
      ],
      adjustmentRemark: "获批折扣率 95.00%，抹零 0.00 元。",
      name: "已批准折扣",
      writeOff: "0.0000",
    },
    {
      discountRate: "1.0000",
      expected: [
        { amount: 20182.2, label: "直接费", number: "（1）" },
        { amount: 2018.22, label: "管理费", number: "（2）" },
        { amount: -100, label: "折扣和抹零", number: "（3）" },
        { amount: 1326.03, label: "税金", number: "（4）" },
        { amount: 23426.45, label: "总造价", number: "（5）" },
      ],
      adjustmentRemark: "获批折扣率 100.00%，抹零 100.00 元。",
      name: "已批准抹零",
      writeOff: "100.0000",
    },
    {
      discountRate: "0.9500",
      expected: [
        { amount: 20182.2, label: "直接费", number: "（1）" },
        { amount: 2018.22, label: "管理费", number: "（2）" },
        { amount: -1210.02, label: "折扣和抹零", number: "（3）" },
        { amount: 1259.42, label: "税金", number: "（4）" },
        { amount: 22249.82, label: "总造价", number: "（5）" },
      ],
      adjustmentRemark: "获批折扣率 95.00%，抹零 100.00 元。",
      name: "已批准折扣和抹零",
      writeOff: "100.0000",
    },
  ])("为$name动态生成同一份 XLSX/PDF 汇总", async ({
    adjustmentRemark,
    discountRate,
    expected,
    writeOff,
  }) => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const quoted = await service.submit(lead, project.id, draft.revision);
    const pending = await service.updateAdjustment(lead, quoted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate,
      expectedRevision: quoted.revision,
      reason: "客户确认优惠",
      writeOff,
    });
    await expect(
      service.createExport(lead, pending.id, "XLSX"),
    ).rejects.toBeInstanceOf(ConflictException);
    const approved = await service.decide(owner, pending.id, "APPROVED", null);

    const xlsx = await service.createExport(owner, approved.id, "XLSX");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      xlsx.payload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "封面",
      "预算说明书",
      "半包报价单",
      "主材报价单",
    ]);
    const halfPackage = workbook.getWorksheet("半包报价单");
    expect(quotationSummaryRows(halfPackage)).toEqual(expected);
    const taxRow = halfPackage?.findRow(
      quotationSummaryRowNumber(halfPackage, "税金"),
    );
    const adjustmentRow = halfPackage?.findRow(
      quotationSummaryRowNumber(halfPackage, "折扣和抹零"),
    );
    expect(adjustmentRow?.getCell(9).text).toBe(adjustmentRemark);
    expect(taxRow?.getCell(9).text).toBe("固定为工程总价6%");
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues())))
      .not.toContain("成本");

    const pdf = await service.createExport(owner, approved.id, "PDF");
    expect(await pdfSectionOrder(pdf.payload)).toEqual([
      "COVER",
      "BUDGET",
      "HALF",
      "MAIN",
    ]);
  }, 60_000);

  it("requires a return reason and keeps pricing adjustments in the next editable version", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    const pending = await service.updateAdjustment(lead, submitted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "0.9500",
      expectedRevision: submitted.revision,
      reason: "客户确认九五折并抹零",
      writeOff: "100.0000",
    });
    await expect(
      service.decide(owner, pending.id, "RETURNED", "  "),
    ).rejects.toBeInstanceOf(BadRequestException);

    const returned = await service.decide(
      owner,
      pending.id,
      "RETURNED",
      "补充客餐厅数量",
    );
    expect(returned.status).toBe("RETURNED");
    await expect(
      service.createExport(owner, returned.id, "PDF"),
    ).rejects.toBeInstanceOf(ConflictException);
    const nextDraft = await service.continueEditing(lead, returned.id);
    expect(nextDraft).toMatchObject({
      adjustedTotal: pending.adjustedTotal,
      adjustmentReason: "客户确认九五折并抹零",
      discountRate: "0.9500",
      status: "DRAFT",
      versionNumber: 3,
      writeOff: "100.0000",
    });
    expect(quotationContent(nextDraft)).toEqual(quotationContent(returned));

    const manualLine = nextDraft.scopes[0]?.lines[0];
    if (!manualLine) throw new Error("返修草稿缺少工程项");
    await expect(
      service.updateLine(lead, project.id, manualLine.id, {
        expectedRevision: nextDraft.revision,
        quantity: "3.0000",
        selected: true,
      }),
    ).resolves.toMatchObject({
      adjustmentReason: "客户确认九五折并抹零",
      discountRate: "0.9500",
      status: "DRAFT",
      writeOff: "100.0000",
    });
  });

  it("keeps an approved version read-only until the owner returns it", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const quoted = await service.submit(lead, project.id, draft.revision);
    const pending = await service.updateAdjustment(lead, quoted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "1.0000",
      expectedRevision: quoted.revision,
      reason: "客户确认不调整",
      writeOff: "0.0000",
    });
    const approved = await service.decide(owner, pending.id, "APPROVED", null);

    await expect(
      service.continueEditing(lead, approved.id),
    ).rejects.toBeInstanceOf(ConflictException);
    const returned = await service.decide(
      owner,
      approved.id,
      "RETURNED",
      "批准后发现漏项",
    );
    expect(returned).toMatchObject({ status: "RETURNED", versionNumber: 3 });
    await expect(
      service.continueEditing(lead, returned.id),
    ).resolves.toMatchObject({ status: "DRAFT", versionNumber: 4 });
  });

  it("does not offer special approval as a new approval action", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const submitted = await service.submit(lead, project.id, draft.revision);
    const pending = await service.updateAdjustment(lead, submitted.id, {
      action: "SUBMIT_FOR_APPROVAL",
      discountRate: "1.0000",
      expectedRevision: submitted.revision,
      reason: "客户确认不调整",
      writeOff: "0.0000",
    });

    await expect(
      service.decide(
        owner,
        pending.id,
        "SPECIAL_APPROVED" as HalfPackageApprovalDecision,
        "风险已确认",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires an adjustment reason before submitting discount approval", async () => {
    const draft = await service.getOrCreateDraft(lead, project.id);
    const quoted = await service.submit(lead, project.id, draft.revision);

    await expect(
      service.updateAdjustment(lead, quoted.id, {
        action: "SUBMIT_FOR_APPROVAL",
        discountRate: "0.9500",
        expectedRevision: quoted.revision,
        reason: "  ",
        writeOff: "100.0000",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lets only the owner or administrator configure the margin benchmark", async () => {
    const quotation = await service.getOrCreateDraft(lead, project.id);

    await expect(
      service.updateMarginBenchmark(lead, project.id, quotation.id, "31"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateMarginBenchmark(owner, project.id, quotation.id, "31.5"),
    ).resolves.toMatchObject({ marginBenchmarkRate: "0.3150" });
    await expect(
      service.updateMarginBenchmark(
        administrator,
        project.id,
        quotation.id,
        "28",
      ),
    ).resolves.toMatchObject({ marginBenchmarkRate: "0.2800" });
    await expect(
      service.updateMarginBenchmark(owner, project.id, quotation.id, "101"),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  async listQuoted(): Promise<readonly QuotationDraft[]> {
    return this.draft?.status === "QUOTED" &&
      this.draft.adjustmentStatus === "PENDING_APPROVAL" &&
      this.draft.isCurrent
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
    if (this.draft) {
      return structuredClone(this.draft);
    }
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

  async saveAdjustment(
    _quotationId: string,
    discountRate: string,
    writeOff: string,
    adjustedTotal: string,
    grossProfit: string,
    grossMarginRate: string | null,
    _actorUserId: string,
    reason: string | null,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new QuotationRevisionConflictError();
    this.draft = {
      ...this.draft,
      adjustedTotal,
      adjustmentReason: reason,
      adjustmentStatus: "PENDING_APPROVAL",
      discountRate,
      grossMarginRate,
      grossProfit,
      revision: this.draft.revision + 1,
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
    if (!this.draft) throw new QuotationRevisionConflictError();
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
    adjustment?: import("../src/quotation/quotation.repository").ConfirmedQuotationAdjustment,
  ): Promise<QuotationDraft> {
    if (!this.draft) throw new QuotationRevisionConflictError();
    this.draft = {
      ...this.draft,
      adjustedTotal: adjustment?.adjustedTotal ?? this.draft.adjustedTotal,
      adjustmentReason: adjustment?.reason ?? this.draft.adjustmentReason,
      adjustmentStatus: action === "RETURNED" ? "AWAITING_SUBMISSION" : "CONFIRMED",
      discountRate: adjustment?.discountRate ?? this.draft.discountRate,
      grossMarginRate: adjustment?.grossMarginRate ?? this.draft.grossMarginRate,
      grossProfit: adjustment?.grossProfit ?? this.draft.grossProfit,
      decidedAt: new Date("2026-08-30T01:00:00Z"),
      decidedByUserId: actorUserId,
      decisionAction: action,
      decisionReason: reason,
      id: `${this.draft.id}-${action.toLowerCase()}`,
      parentVersionId: this.draft.id,
      status: action === "RETURNED" ? "RETURNED" : "APPROVED",
      versionNumber: this.draft.versionNumber + 1,
      writeOff: adjustment?.writeOff ?? this.draft.writeOff,
    };
    return structuredClone(this.draft);
  }

  async continueEditing(
    source: QuotationDraft,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    const preserveAdjustment = source.status === "RETURNED";
    this.draft = {
      ...structuredClone(source),
      adjustedTotal: preserveAdjustment ? source.adjustedTotal : source.total,
      createdByUserId: actorUserId,
      id: `${source.id}-copy`,
      parentVersionId: source.id,
      adjustmentReason: preserveAdjustment ? source.adjustmentReason : null,
      adjustmentStatus: "AWAITING_SUBMISSION",
      discountRate: preserveAdjustment ? source.discountRate : "1.0000",
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

function quotationContent(quotation: {
  readonly scopes: readonly {
    readonly lines: readonly {
      readonly amount: string | null;
      readonly itemName: string;
      readonly quantity: string | null;
      readonly saleUnitPrice: string;
      readonly selected: boolean;
    }[];
    readonly name: string;
    readonly subtotal: string;
  }[];
}) {
  return quotation.scopes.map((scope) => ({
    lines: scope.lines.map((line) => ({
      amount: line.amount,
      itemName: line.itemName,
      quantity: line.quantity,
      saleUnitPrice: line.saleUnitPrice,
      selected: line.selected,
    })),
    name: scope.name,
    subtotal: scope.subtotal,
  }));
}

function quotationSummaryRows(
  worksheet: ExcelJS.Worksheet | undefined,
): Array<{ amount: number; label: string; number: string }> {
  const rows: Array<{ amount: number; label: string; number: string }> = [];
  worksheet?.eachRow((row) => {
    const label = row.getCell(3).text;
    if (!["直接费", "管理费", "折扣和抹零", "税金", "总造价"].includes(label)) {
      return;
    }
    rows.push({
      amount: Number(row.getCell(7).value),
      label,
      number: row.getCell(2).text,
    });
  });
  return rows;
}

function quotationSummaryRowNumber(
  worksheet: ExcelJS.Worksheet | undefined,
  label: string,
): number {
  let rowNumber = 0;
  worksheet?.eachRow((row) => {
    if (row.getCell(3).text === label) rowNumber = row.number;
  });
  return rowNumber;
}

function workbookFormulaCells(workbook: ExcelJS.Workbook): string[] {
  const cells: string[] = [];
  workbook.worksheets.forEach((worksheet) => worksheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (cell.type === ExcelJS.ValueType.Formula) {
        cells.push(`${worksheet.name}!${cell.address}`);
      }
    }),
  ));
  return cells;
}

async function pdfSectionOrder(payload: Buffer): Promise<string[]> {
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

const owner: SessionUser = {
  account: "owner",
  displayName: "何总",
  id: "11111111-1111-4111-8111-111111111111",
  phone: null,
  role: "OWNER",
};

const administrator: SessionUser = {
  account: "admin",
  displayName: "系统管理员",
  id: "00000000-0000-4000-8000-000000000001",
  phone: null,
  role: "ADMIN",
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
  customerName: "林先生",
  id: "44444444-4444-4444-8444-444444444444",
  leadDesigner: lead,
  outerFrameArea: "130.0000",
  projectAddress: "上海市静安区测试路 1 号",
  quotationAmount: null,
  quotationId: null,
  quotationStatus: null,
  quotationVersion: null,
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
  updatedAt: "2026-08-30T00:00:00.000Z",
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
      "160.0000",
      "1、人工费；\n2、垃圾装袋运至小区指定点，如需要运到小区外费用另计。",
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
  remarks: string | null = null,
): QuotationTemplate["items"][number] {
  return {
    costUnitPrice,
    id,
    itemName,
    remarks,
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
