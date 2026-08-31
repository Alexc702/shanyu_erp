import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  HalfPackageApprovalAction,
  HalfPackageApprovalSummary,
  HalfPackageCostMargin,
  HalfPackageSectionCode,
  HalfPackageSubmissionCheck,
  HalfPackageVersionDifference,
  ProjectDetail,
  SessionUser,
  SpaceType,
} from "@shanyu/contracts";
import { createHash, randomUUID } from "node:crypto";

import { AccessPolicy } from "../access/access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../access/audit.repository";
import {
  HalfPackageCalculator,
  type QuantityRule,
} from "./half-package-calculator";
import {
  QUOTATION_REPOSITORY,
  type QuotationDraft,
  type QuotationDraftLine,
  type QuotationDraftScope,
  type QuotationExport,
  type QuotationExportFormat,
  type QuotationRepository,
  QuotationRevisionConflictError,
  type QuotationTemplate,
  type QuotationTemplateItem,
} from "./quotation.repository";
import { QuotationExporter } from "./quotation-exporter";

export interface UpdateQuotationLineInput {
  readonly expectedRevision: number;
  readonly quantity: string | null;
  readonly selected: boolean;
}

export interface QuotationLineView {
  readonly amount: string | null;
  readonly id: string;
  readonly itemName: string;
  readonly quantity: string | null;
  readonly quantitySource: QuantityRule["kind"];
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionName: string;
  readonly selected: boolean;
  readonly unit: string;
}

export interface QuotationScopeView {
  readonly area: string | null;
  readonly height: string | null;
  readonly id: string;
  readonly lines: readonly QuotationLineView[];
  readonly name: string;
  readonly perimeter: string | null;
  readonly projectSpaceId: string | null;
  readonly spaceType: SpaceType | null;
  readonly subtotal: string;
}

export interface QuotationView {
  readonly directCost: string;
  readonly id: string;
  readonly managementFee: string;
  readonly managementRate: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly revision: number;
  readonly scopes: readonly QuotationScopeView[];
  readonly status: QuotationDraft["status"];
  readonly submittedAt: string | null;
  readonly templateVersion: number;
  readonly total: string;
  readonly versionNumber: number;
}

@Injectable()
export class QuotationService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(QUOTATION_REPOSITORY)
    private readonly quotationRepository: QuotationRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
    private readonly calculator: HalfPackageCalculator,
    private readonly exporter: QuotationExporter = new QuotationExporter(),
  ) {}

  async getOrCreateDraft(
    actor: SessionUser,
    projectId: string,
  ): Promise<QuotationView> {
    const project = await this.authorizedProject(actor, projectId);
    const existing = await this.quotationRepository.findDraft(projectId);
    if (existing) {
      return toView(
        await this.addMissingProjectScopes(actor, project, existing),
      );
    }
    const latest = await this.quotationRepository.findLatest(projectId);
    if (latest) {
      return toView(latest);
    }
    const template = await this.quotationRepository.findPublishedTemplate();
    if (!template) {
      throw new ConflictException("当前没有可用于报价的已发布主材库版本");
    }
    const draft = this.calculate(
      buildDraft(actor.id, project, template),
    );
    const created = await this.quotationRepository.createDraft(draft);
    await this.auditRepository.append({
      action: "QUOTATION_DRAFT_CREATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: created.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toView(created);
  }

  async updateLine(
    actor: SessionUser,
    projectId: string,
    lineId: string,
    input: UpdateQuotationLineInput,
  ): Promise<QuotationView> {
    await this.authorizedProject(actor, projectId);
    validateUpdateInput(input);
    const draft = await this.quotationRepository.findDraft(projectId);
    if (!draft) {
      throw new NotFoundException("半包报价草稿不存在");
    }
    const currentLine = draft.scopes
      .flatMap((scope) => scope.lines)
      .find((line) => line.id === lineId);
    if (!currentLine) {
      throw new NotFoundException("报价工程项不存在");
    }
    const normalizedQuantity = normalizeManualQuantity(input.quantity);
    if (
      currentLine.quantityRule.kind !== "MANUAL" &&
      normalizedQuantity !== null
    ) {
      throw new BadRequestException("自动数量不能通过请求手工覆盖");
    }
    if (!input.selected && normalizedQuantity !== null) {
      throw new BadRequestException("未选择的工程项不能填写数量");
    }

    const changed: QuotationDraft = {
      ...draft,
      revision: input.expectedRevision + 1,
      scopes: draft.scopes.map((scope) => ({
        ...scope,
        lines: scope.lines.map((line) =>
          line.id === lineId
            ? {
                ...line,
                manualQuantity:
                  line.quantityRule.kind === "MANUAL"
                    ? normalizedQuantity
                    : null,
                selected: input.selected,
              }
            : line,
        ),
      })),
    };
    const calculated = this.calculate(changed);
    let saved: QuotationDraft;
    try {
      saved = await this.quotationRepository.saveDraft(
        calculated,
        input.expectedRevision,
      );
    } catch (error) {
      if (error instanceof QuotationRevisionConflictError) {
        throw new ConflictException("报价已被其他操作更新，请刷新后重试");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "QUOTATION_LINE_UPDATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: lineId,
      targetType: "HALF_PACKAGE_QUOTATION_LINE",
    });
    return toView(saved);
  }

  async getCostMargin(
    actor: SessionUser,
    projectId: string,
  ): Promise<HalfPackageCostMargin> {
    this.accessPolicy.assertCanViewSensitivePricing(actor);
    const quotation = await this.getOrCreateDraft(actor, projectId);
    const draft = await this.quotationRepository.findById(quotation.id);
    if (!draft) {
      throw new NotFoundException("半包报价草稿不存在");
    }
    await this.auditRepository.append({
      action: "QUOTATION_COST_MARGIN_VIEWED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: draft.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toCostMargin(draft);
  }

  async checkSubmission(
    actor: SessionUser,
    projectId: string,
  ): Promise<HalfPackageSubmissionCheck> {
    await this.authorizedProject(actor, projectId);
    const draft = await this.quotationRepository.findDraft(projectId);
    if (!draft) {
      throw new NotFoundException("半包报价草稿不存在");
    }
    return this.submissionCheck(draft);
  }

  async submit(
    actor: SessionUser,
    projectId: string,
    expectedRevision: number,
  ): Promise<QuotationView> {
    await this.authorizedProject(actor, projectId);
    const draft = await this.quotationRepository.findDraft(projectId);
    if (!draft) {
      throw new NotFoundException("半包报价草稿不存在");
    }
    const check = await this.submissionCheck(draft);
    if (check.blockerCount > 0) {
      throw new BadRequestException(
        `提交前仍有 ${check.blockerCount} 个阻断项：${check.blockers.join("；")}`,
      );
    }
    let submitted: QuotationDraft;
    try {
      submitted = await this.quotationRepository.submitDraft(
        draft.id,
        actor.id,
        expectedRevision,
      );
    } catch (error) {
      if (error instanceof QuotationRevisionConflictError) {
        throw new ConflictException("报价已变化，请重新检查后提交");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "QUOTATION_SUBMITTED",
      actorUserId: actor.id,
      afterState: { status: submitted.status, version: submitted.versionNumber },
      beforeState: { status: draft.status, version: draft.versionNumber },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: submitted.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toView(submitted);
  }

  async listPendingApprovals(
    actor: SessionUser,
  ): Promise<readonly HalfPackageApprovalSummary[]> {
    this.accessPolicy.assertCanApproveQuotation(actor);
    const quotations = await this.quotationRepository.listPendingApproval();
    return Promise.all(
      quotations.map(async (quotation) => {
        const project = await this.quotationRepository.findProject(
          quotation.projectId,
        );
        if (!project) {
          throw new Error("待审批报价关联项目不存在");
        }
        return {
          buildingArea: project.buildingArea,
          customerName: project.customerName,
          id: quotation.id,
          projectId: quotation.projectId,
          projectName: quotation.projectName,
          salesAmount: quotation.total,
          status: quotation.status,
          submittedAt: quotation.submittedAt?.toISOString() ?? null,
          versionNumber: quotation.versionNumber,
        };
      }),
    );
  }

  async getVersion(
    actor: SessionUser,
    quotationId: string,
  ): Promise<QuotationView> {
    return toView(await this.authorizedVersion(actor, quotationId));
  }

  async getVersionCostMargin(
    actor: SessionUser,
    quotationId: string,
  ): Promise<HalfPackageCostMargin> {
    this.accessPolicy.assertCanViewSensitivePricing(actor);
    return toCostMargin(await this.authorizedVersion(actor, quotationId));
  }

  async decide(
    actor: SessionUser,
    quotationId: string,
    action: HalfPackageApprovalAction,
    reason: string | null,
  ): Promise<QuotationView> {
    this.accessPolicy.assertCanApproveQuotation(actor);
    const current = await this.authorizedVersion(actor, quotationId);
    const normalizedReason = reason?.trim() || null;
    if (
      (action === "RETURNED" || action === "SPECIAL_APPROVED") &&
      !normalizedReason
    ) {
      throw new BadRequestException("退回或特批必须填写审批意见");
    }
    let decided: QuotationDraft;
    try {
      decided = await this.quotationRepository.decide(
        quotationId,
        actor.id,
        action,
        normalizedReason,
      );
    } catch (error) {
      if (error instanceof QuotationRevisionConflictError) {
        throw new ConflictException("该报价已被审批，请刷新后重试");
      }
      throw error;
    }
    if (action === "RETURNED") {
      await this.quotationRepository.createDraftFromVersion(decided, actor.id);
    }
    const auditAction =
      action === "RETURNED"
        ? "QUOTATION_RETURNED"
        : action === "SPECIAL_APPROVED"
          ? "QUOTATION_SPECIAL_APPROVED"
          : "QUOTATION_APPROVED";
    await this.auditRepository.append({
      action: auditAction,
      actorUserId: actor.id,
      afterState: { status: decided.status },
      beforeState: { status: current.status },
      occurredAt: new Date(),
      reason: normalizedReason,
      result: "SUCCESS",
      targetId: decided.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toView(decided);
  }

  async listVersions(actor: SessionUser, projectId: string) {
    await this.authorizedProject(actor, projectId);
    const versions = await this.quotationRepository.listByProject(projectId);
    return versions.map((version) => ({
      decisionAction: version.decisionAction,
      decisionReason: version.decisionReason,
      id: version.id,
      status: version.status,
      submittedAt: version.submittedAt?.toISOString() ?? null,
      total: version.total,
      versionNumber: version.versionNumber,
    }));
  }

  async cloneVersion(
    actor: SessionUser,
    quotationId: string,
  ): Promise<QuotationView> {
    const source = await this.authorizedVersion(actor, quotationId);
    if (!["APPROVED", "SUPERSEDED", "RETURNED"].includes(source.status)) {
      throw new ConflictException("仅可复制已审批、已替代或已退回的版本");
    }
    if (await this.quotationRepository.findDraft(source.projectId)) {
      throw new ConflictException("当前项目已有报价草稿");
    }
    const created = await this.quotationRepository.createDraftFromVersion(
      source,
      actor.id,
    );
    await this.auditRepository.append({
      action: "QUOTATION_VERSION_CLONED",
      actorUserId: actor.id,
      afterState: { version: created.versionNumber },
      beforeState: { version: source.versionNumber },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: created.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toView(created);
  }

  async compareVersions(
    actor: SessionUser,
    fromId: string,
    toId: string,
  ): Promise<{
    differences: readonly HalfPackageVersionDifference[];
    fromVersion: number;
    toVersion: number;
  }> {
    const from = await this.authorizedVersion(actor, fromId);
    const to = await this.authorizedVersion(actor, toId);
    if (from.projectId !== to.projectId) {
      throw new BadRequestException("只能对比同一项目的报价版本");
    }
    const differences = compareQuotationVersions(from, to);
    await this.auditRepository.append({
      action: "QUOTATION_VERSION_COMPARED",
      actorUserId: actor.id,
      metadata: { fromVersion: from.versionNumber, toVersion: to.versionNumber },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: to.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return {
      differences,
      fromVersion: from.versionNumber,
      toVersion: to.versionNumber,
    };
  }

  async createExport(
    actor: SessionUser,
    quotationId: string,
    format: QuotationExportFormat,
  ): Promise<QuotationExport> {
    const quotation = await this.authorizedVersion(actor, quotationId);
    if (quotation.status !== "APPROVED" && quotation.status !== "SUPERSEDED") {
      throw new ConflictException("仅已审批报价可导出客户版文件");
    }
    const generated = await this.exporter.generate(quotation, format);
    const created = await this.quotationRepository.createExport({
      ...generated,
      createdAt: new Date(),
      createdByUserId: actor.id,
      format,
      id: randomUUID(),
      quotationId: quotation.id,
      sha256: createHash("sha256").update(generated.payload).digest("hex"),
    });
    await this.auditRepository.append({
      action: "QUOTATION_EXPORTED",
      actorUserId: actor.id,
      metadata: { format, sha256: created.sha256 },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: created.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return created;
  }

  async getExport(
    actor: SessionUser,
    exportId: string,
  ): Promise<QuotationExport> {
    const result = await this.quotationRepository.findExport(exportId);
    if (!result) {
      throw new NotFoundException("导出文件不存在");
    }
    await this.authorizedVersion(actor, result.quotationId);
    return result;
  }

  private async authorizedProject(
    actor: SessionUser,
    projectId: string,
  ): Promise<ProjectDetail> {
    const project = await this.quotationRepository.findProject(projectId);
    if (!project) {
      throw new NotFoundException("项目不存在");
    }
    this.accessPolicy.assertCanAccessProject(actor, project.leadDesigner.id);
    return project;
  }

  private async submissionCheck(
    draft: QuotationDraft,
  ): Promise<HalfPackageSubmissionCheck> {
    const template = await this.quotationRepository.findTemplate(
      draft.templateVersionId,
      draft.ruleVersionId,
    );
    if (!template) {
      throw new ConflictException("报价固定引用的主材库版本不存在");
    }
    return submissionCheck(
      draft,
      template.items.length,
      new Set(template.items.map((item) => item.sectionCode)).size,
    );
  }

  private async authorizedVersion(
    actor: SessionUser,
    quotationId: string,
  ): Promise<QuotationDraft> {
    const quotation = await this.quotationRepository.findById(quotationId);
    if (!quotation) {
      throw new NotFoundException("半包报价版本不存在");
    }
    await this.authorizedProject(actor, quotation.projectId);
    return quotation;
  }

  private async addMissingProjectScopes(
    actor: SessionUser,
    project: ProjectDetail,
    draft: QuotationDraft,
  ): Promise<QuotationDraft> {
    const quotedSpaceIds = new Set(
      draft.scopes.flatMap((scope) =>
        scope.projectSpaceId ? [scope.projectSpaceId] : [],
      ),
    );
    const missingSpaces = project.spaces.filter(
      (space) => !quotedSpaceIds.has(space.id),
    );
    if (missingSpaces.length === 0) {
      return this.calculate(draft);
    }
    const template = await this.quotationRepository.findTemplate(
      draft.templateVersionId,
      draft.ruleVersionId,
    );
    if (!template) {
      throw new ConflictException("报价固定引用的主材库版本不存在");
    }
    const firstSortOrder =
      Math.max(-1, ...draft.scopes.map((scope) => scope.sortOrder)) + 1;
    const addedScopes = missingSpaces.map((space, index) => {
      const sectionCodes = sectionCodesForSpace(
        space.type,
        space.includesBalcony,
      );
      return buildScope(
        space.displayName,
        space.id,
        space.type,
        space.area,
        space.perimeter,
        space.height,
        firstSortOrder + index,
        template.items.filter((item) =>
          sectionCodes.includes(item.sectionCode),
        ),
      );
    });
    const calculated = this.calculate({
      ...draft,
      revision: draft.revision + 1,
      scopes: [...draft.scopes, ...addedScopes],
    });
    let saved: QuotationDraft;
    try {
      saved = await this.quotationRepository.addDraftScopes(
        calculated,
        addedScopes,
        draft.revision,
      );
    } catch (error) {
      if (error instanceof QuotationRevisionConflictError) {
        throw new ConflictException("报价已被其他操作更新，请刷新后重试");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "QUOTATION_SCOPES_SYNCED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: saved.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return saved;
  }

  private calculate(draft: QuotationDraft): QuotationDraft {
    const result = this.calculator.calculate({
      buildingArea: draft.buildingArea,
      managementRate: draft.managementRate,
      scopes: draft.scopes.map((scope) => ({
        area: scope.area,
        height: scope.height,
        id: scope.id,
        lines: scope.lines.map((line) => ({
          costUnitPrice: line.costUnitPrice,
          id: line.id,
          manualQuantity: line.manualQuantity,
          quantityRule: line.quantityRule,
          saleUnitPrice: line.saleUnitPrice,
          selected: line.selected,
        })),
        perimeter: scope.perimeter,
      })),
    });
    const calculatedScopes = new Map(
      result.scopes.map((scope) => [scope.id, scope] as const),
    );
    return {
      ...draft,
      directCost: result.directCost,
      expectedCost: result.expectedCost,
      grossMarginRate: result.grossMarginRate,
      grossProfit: result.grossProfit,
      managementFee: result.managementFee,
      scopes: draft.scopes.map((scope) => {
        const calculatedScope = calculatedScopes.get(scope.id);
        if (!calculatedScope) {
          throw new Error("服务端计价缺少报价范围");
        }
        const lines = new Map(
          calculatedScope.lines.map((line) => [line.id, line] as const),
        );
        return {
          ...scope,
          expectedCost: calculatedScope.expectedCost,
          grossMarginRate: calculatedScope.grossMarginRate,
          grossProfit: calculatedScope.grossProfit,
          lines: scope.lines.map((line) => {
            const calculatedLine = lines.get(line.id);
            if (!calculatedLine) {
              throw new Error("服务端计价缺少报价工程项");
            }
            return {
              ...line,
              amount: calculatedLine.amount,
              calculatedQuantity: calculatedLine.quantity,
              costAmount: calculatedLine.costAmount,
              grossMarginRate: calculatedLine.grossMarginRate,
              grossProfit: calculatedLine.grossProfit,
            };
          }),
          subtotal: calculatedScope.subtotal,
        };
      }),
      total: result.total,
    };
  }
}

function buildDraft(
  actorUserId: string,
  project: ProjectDetail,
  template: QuotationTemplate,
): QuotationDraft {
  const scopes: QuotationDraftScope[] = [];
  for (const sectionCode of ["WALL"] satisfies HalfPackageSectionCode[]) {
    const items = template.items.filter(
      (item) => item.sectionCode === sectionCode,
    );
    if (items.length === 0) {
      continue;
    }
    scopes.push(
      buildScope(
        items[0]?.sectionName ?? sectionCode,
        null,
        null,
        null,
        null,
        null,
        scopes.length,
        items,
      ),
    );
  }
  for (const space of project.spaces) {
    const sectionCodes = sectionCodesForSpace(
      space.type,
      space.includesBalcony,
    );
    const items = template.items.filter((item) =>
      sectionCodes.includes(item.sectionCode),
    );
    scopes.push(
      buildScope(
        space.displayName,
        space.id,
        space.type,
        space.area,
        space.perimeter,
        space.height,
        scopes.length,
        items,
      ),
    );
  }
  for (const sectionCode of [
    "PAINT",
    "ELECTRICAL",
    "OTHER",
  ] satisfies HalfPackageSectionCode[]) {
    const items = template.items.filter(
      (item) => item.sectionCode === sectionCode,
    );
    if (items.length === 0) {
      continue;
    }
    scopes.push(
      buildScope(
        items[0]?.sectionName ?? sectionCode,
        null,
        null,
        null,
        null,
        null,
        scopes.length,
        items,
      ),
    );
  }

  return {
    buildingArea: project.buildingArea,
    costTemplateVersionId: template.id,
    costTemplateVersionNumber: template.versionNumber,
    createdByUserId: actorUserId,
    directCost: "0.0000",
    expectedCost: "0.0000",
    grossMarginRate: null,
    grossProfit: "0.0000",
    id: randomUUID(),
    managementFee: "0.0000",
    managementRate: "0.1000",
    parentVersionId: null,
    projectId: project.id,
    projectName: project.name,
    revision: 0,
    ruleVersionId: template.ruleVersionId,
    scopes,
    status: "DRAFT",
    submittedAt: null,
    submittedByUserId: null,
    decidedAt: null,
    decidedByUserId: null,
    decisionAction: null,
    decisionReason: null,
    templateVersionId: template.id,
    templateVersionNumber: template.versionNumber,
    total: "0.0000",
    versionNumber: 1,
  };
}

function buildScope(
  name: string,
  projectSpaceId: string | null,
  spaceType: SpaceType | null,
  area: string | null,
  perimeter: string | null,
  height: string | null,
  sortOrder: number,
  items: readonly QuotationTemplateItem[],
): QuotationDraftScope {
  const baseLines = items.map((item) => ({
    amount: null,
    calculatedQuantity: null,
    costAmount: null,
    costUnitPrice: item.costUnitPrice,
    grossMarginRate: null,
    grossProfit: null,
    id: randomUUID(),
    itemName: item.itemName,
    manualQuantity: null,
    quantityRule: { kind: "MANUAL" } as QuantityRule,
    remarks: item.remarks,
    saleUnitPrice: item.saleUnitPrice,
    sectionCode: item.sectionCode,
    sectionName: item.sectionName,
    selected: false,
    sortOrder: item.sortOrder,
    unit: item.unit,
    versionItemId: item.id,
  }));
  const lines: QuotationDraftLine[] = baseLines.map((line) => {
    const quantityRule = quantityRuleFor(line, baseLines);
    return {
      ...line,
      quantityRule,
      selected: quantityRule.kind !== "MANUAL",
    };
  });
  return {
    area,
    expectedCost: "0.0000",
    grossMarginRate: null,
    grossProfit: "0.0000",
    height,
    id: randomUUID(),
    lines,
    name,
    perimeter,
    projectSpaceId,
    sortOrder,
    spaceType,
    subtotal: "0.0000",
  };
}

function quantityRuleFor(
  line: Pick<QuotationDraftLine, "id" | "itemName" | "sectionCode">,
  scopeLines: readonly Pick<
    QuotationDraftLine,
    "id" | "itemName" | "sectionCode"
  >[],
): QuantityRule {
  if (line.sectionCode === "PAINT") {
    return { kind: "PROJECT_BUILDING_AREA" };
  }
  if (
    line.sectionCode === "ELECTRICAL" &&
    electricalBuildingAreaItems.has(line.itemName)
  ) {
    return { kind: "PROJECT_BUILDING_AREA" };
  }
  if (
    line.sectionCode === "OTHER" &&
    otherBuildingAreaItems.has(line.itemName)
  ) {
    return { kind: "PROJECT_BUILDING_AREA" };
  }
  if (
    (line.sectionCode === "LIVING_DINING" ||
      line.sectionCode === "BEDROOM") &&
    line.itemName === "顶面基层处理"
  ) {
    return { kind: "SPACE_AREA" };
  }
  if (
    (line.sectionCode === "LIVING_DINING" ||
      line.sectionCode === "BEDROOM") &&
    line.itemName === "墙面基层处理"
  ) {
    return { kind: "SPACE_PERIMETER_HEIGHT" };
  }
  const referenceName = referencedItemName(line.sectionCode, line.itemName);
  if (referenceName) {
    const referenced = scopeLines.find(
      (candidate) =>
        candidate.sectionCode === line.sectionCode &&
        candidate.itemName === referenceName,
    );
    if (!referenced) {
      throw new Error(`自动数量规则缺少稳定工程项：${referenceName}`);
    }
    return {
      kind: "LINE_REFERENCE",
      referencedLineId: referenced.id,
    };
  }
  if (
    line.sectionCode === "KITCHEN_BATHROOM" &&
    line.itemName === "防水石膏板吊平顶"
  ) {
    return { kind: "SPACE_AREA" };
  }
  return { kind: "MANUAL" };
}

function referencedItemName(
  sectionCode: HalfPackageSectionCode,
  itemName: string,
): string | null {
  if (
    (sectionCode === "LIVING_DINING" || sectionCode === "BEDROOM") &&
    itemName === "顶面乳胶漆"
  ) {
    return "顶面基层处理";
  }
  if (
    (sectionCode === "LIVING_DINING" || sectionCode === "BEDROOM") &&
    itemName === "墙面乳胶漆"
  ) {
    return "墙面基层处理";
  }
  if (
    sectionCode === "KITCHEN_BATHROOM" &&
    itemName === "顶面基层处理(防水腻子）"
  ) {
    return "防水石膏板吊平顶";
  }
  return null;
}

function sectionCodesForSpace(
  spaceType: SpaceType,
  includesBalcony: boolean,
): HalfPackageSectionCode[] {
  switch (spaceType) {
    case "LIVING_DINING":
      return includesBalcony
        ? ["LIVING_DINING", "BALCONY"]
        : ["LIVING_DINING"];
    case "BEDROOM":
    case "CLOSET":
      return ["BEDROOM"];
    case "KITCHEN":
    case "BATHROOM":
      return ["KITCHEN_BATHROOM"];
    case "BALCONY":
      return ["LIVING_DINING"];
  }
}

function validateUpdateInput(input: UpdateQuotationLineInput): void {
  if (
    !input ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    typeof input.selected !== "boolean" ||
    (input.quantity !== null && typeof input.quantity !== "string")
  ) {
    throw new BadRequestException("报价工程项保存信息不完整");
  }
}

function normalizeManualQuantity(value: string | null): string | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new BadRequestException("数量必须大于 0，且最多保留 4 位小数");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}.${fraction.padEnd(4, "0")}`;
}

function toView(draft: QuotationDraft): QuotationView {
  return {
    directCost: draft.directCost,
    id: draft.id,
    managementFee: draft.managementFee,
    managementRate: draft.managementRate,
    projectId: draft.projectId,
    projectName: draft.projectName,
    revision: draft.revision,
    scopes: draft.scopes.map((scope) => ({
      area: scope.area,
      height: scope.height,
      id: scope.id,
      lines: scope.lines.map((line) => ({
        amount: line.amount,
        id: line.id,
        itemName: line.itemName,
        quantity: line.calculatedQuantity,
        quantitySource: line.quantityRule.kind,
        remarks: line.remarks,
        saleUnitPrice: line.saleUnitPrice,
        sectionName: line.sectionName,
        selected: line.selected,
        unit: line.unit,
      })),
      name: scope.name,
      perimeter: scope.perimeter,
      projectSpaceId: scope.projectSpaceId,
      spaceType: scope.spaceType,
      subtotal: scope.subtotal,
    })),
    status: draft.status,
    submittedAt: draft.submittedAt?.toISOString() ?? null,
    templateVersion: draft.templateVersionNumber,
    total: draft.total,
    versionNumber: draft.versionNumber,
  };
}

function toCostMargin(draft: QuotationDraft): HalfPackageCostMargin {
  return {
    costVersion: {
      id: draft.costTemplateVersionId,
      versionNumber: draft.costTemplateVersionNumber,
    },
    expectedCost: draft.expectedCost,
    grossMarginRate: draft.grossMarginRate,
    grossProfit: draft.grossProfit,
    id: draft.id,
    projectId: draft.projectId,
    projectName: draft.projectName,
    salesAmount: draft.directCost,
    scopes: draft.scopes.map((scope) => ({
      expectedCost: scope.expectedCost,
      grossMarginRate: scope.grossMarginRate,
      grossProfit: scope.grossProfit,
      id: scope.id,
      lines: scope.lines.flatMap((line) =>
        line.calculatedQuantity !== null &&
        line.amount !== null &&
        line.costAmount !== null &&
        line.grossProfit !== null &&
        line.grossMarginRate !== null
          ? [
              {
                costAmount: line.costAmount,
                costUnitPrice: line.costUnitPrice,
                grossMarginRate: line.grossMarginRate,
                grossProfit: line.grossProfit,
                id: line.id,
                itemName: line.itemName,
                quantity: line.calculatedQuantity,
                saleAmount: line.amount,
                saleUnitPrice: line.saleUnitPrice,
                unit: line.unit,
              },
            ]
          : [],
      ),
      name: scope.name,
      salesAmount: scope.subtotal,
      spaceType: scope.spaceType,
    })),
    status: draft.status,
  };
}

function submissionCheck(
  draft: QuotationDraft,
  templateItemCount: number,
  templateSectionCount: number,
): HalfPackageSubmissionCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const allLines = draft.scopes.flatMap((scope) =>
    scope.lines.map((line) => ({ line, scopeName: scope.name })),
  );
  for (const { line, scopeName } of allLines) {
    if (line.selected && line.calculatedQuantity === null) {
      blockers.push(`${scopeName} / ${line.itemName} 缺少数量`);
    }
    if (line.selected && !line.remarks) {
      warnings.push(`${scopeName} / ${line.itemName} 暂无施工说明`);
    }
  }
  return {
    blockerCount: blockers.length,
    blockers,
    itemCount: templateItemCount,
    sectionCount: templateSectionCount,
    selectedItemCount: allLines.filter(({ line }) => line.selected).length,
    warningCount: warnings.length,
    warnings,
  };
}

function compareQuotationVersions(
  from: QuotationDraft,
  to: QuotationDraft,
): HalfPackageVersionDifference[] {
  const differences: HalfPackageVersionDifference[] = [];
  const fromLines = new Map(
    from.scopes.flatMap((scope) =>
      scope.lines.map((line) => [
        `${scope.projectSpaceId ?? scope.name}:${line.versionItemId}`,
        { line, scopeName: scope.name },
      ] as const),
    ),
  );
  for (const scope of to.scopes) {
    for (const line of scope.lines) {
      const previous = fromLines.get(
        `${scope.projectSpaceId ?? scope.name}:${line.versionItemId}`,
      );
      for (const [field, before, after] of [
        ["SELECTED", previous ? String(previous.line.selected) : null, String(line.selected)],
        ["QUANTITY", previous?.line.calculatedQuantity ?? null, line.calculatedQuantity],
        ["SALE_UNIT_PRICE", previous?.line.saleUnitPrice ?? null, line.saleUnitPrice],
      ] as const) {
        if (before !== after) {
          differences.push({
            after,
            before,
            field,
            itemName: line.itemName,
            scopeName: scope.name,
          });
        }
      }
    }
  }
  if (from.total !== to.total) {
    differences.push({
      after: to.total,
      before: from.total,
      field: "TOTAL",
      itemName: "报价合计",
      scopeName: "项目",
    });
  }
  return differences;
}

const electricalBuildingAreaItems = new Set([
  "开管线槽",
  "打孔穿线",
  "给水工程（PPR）",
  "排水工程（PVC）",
  "强电工程（1.5；2.5BV线；4.0Bvr线）",
  "弱电工程（6类网线，电视线）",
  "正泰空开更换",
]);

const otherBuildingAreaItems = new Set([
  "装潢垃圾清理费",
  "室内家政服务费",
]);
