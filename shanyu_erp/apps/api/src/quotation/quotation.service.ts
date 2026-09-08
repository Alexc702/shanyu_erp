import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  HalfPackageApprovalDecision,
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
  readonly adjustmentReason: string | null;
  readonly adjustmentStatus: QuotationDraft["adjustmentStatus"];
  readonly adjustedTotal: string;
  readonly directCost: string;
  readonly discountRate: string;
  readonly id: string;
  readonly isCurrent: boolean;
  readonly managementFee: string;
  readonly managementRate: string;
  readonly projectId: string;
  readonly projectAddress: string;
  readonly revision: number;
  readonly scopes: readonly QuotationScopeView[];
  readonly status: QuotationDraft["status"];
  readonly submittedAt: string | null;
  readonly templateVersion: number;
  readonly total: string;
  readonly versionNumber: number;
  readonly writeOff: string;
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
    if (created.id === draft.id) {
      await this.auditRepository.append({
        action: "QUOTATION_DRAFT_CREATED",
        actorUserId: actor.id,
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: created.id,
        targetType: "HALF_PACKAGE_QUOTATION",
      });
    }
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
        lines: scope.lines.map((line) => {
          if (line.id === lineId) {
            return {
              ...line,
              manualQuantity:
                line.quantityRule.kind === "MANUAL"
                  ? normalizedQuantity
                  : null,
              selected: input.selected,
            };
          }
          return line.quantityRule.kind === "LINE_REFERENCE" &&
            line.quantityRule.referencedLineId === lineId
            ? { ...line, selected: input.selected }
            : line;
        }),
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
      afterState: {
        quantity: saved.scopes
          .flatMap((scope) => scope.lines)
          .find((line) => line.id === lineId)?.calculatedQuantity ?? null,
        revision: saved.revision,
        selected: input.selected,
        version: saved.versionNumber,
      },
      beforeState: {
        quantity: currentLine.calculatedQuantity,
        revision: draft.revision,
        selected: currentLine.selected,
        version: draft.versionNumber,
      },
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
        `生成前仍有 ${check.blockerCount} 个阻断项：${check.blockers.join("；")}`,
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
        throw new ConflictException("报价已变化，请重新检查后生成");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "QUOTATION_GENERATED",
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
    const quotations = await this.quotationRepository.listQuoted();
    return Promise.all(
      quotations.map(async (quotation) => {
        const project = await this.quotationRepository.findProject(
          quotation.projectId,
        );
        if (!project) {
          throw new Error("已报价版本关联项目不存在");
        }
        return {
          customerName: project.customerName,
          expectedCost: quotation.expectedCost,
          grossMarginRate: quotation.grossMarginRate,
          grossProfit: quotation.grossProfit,
          id: quotation.id,
          outerFrameArea: project.outerFrameArea,
          projectId: quotation.projectId,
          projectAddress: quotation.projectAddress,
          salesAmount: quotation.adjustedTotal,
          status: quotation.status,
          submittedAt: quotation.submittedAt?.toISOString() ?? null,
          thirdPartyPurchaseAmount: null,
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

  async updateMarginBenchmark(
    actor: SessionUser,
    projectId: string,
    quotationId: string,
    marginBenchmarkPercent: string,
  ): Promise<HalfPackageCostMargin> {
    this.accessPolicy.assertCanViewSensitivePricing(actor);
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(marginBenchmarkPercent)) {
      throw new BadRequestException("基准毛利率须为 0–100，最多两位小数");
    }
    const percent = Number(marginBenchmarkPercent);
    if (percent < 0 || percent > 100) {
      throw new BadRequestException("基准毛利率须为 0–100，最多两位小数");
    }
    const quotation = await this.authorizedVersion(actor, quotationId);
    if (quotation.projectId !== projectId) {
      throw new NotFoundException("报价版本不存在");
    }
    const updated = await this.quotationRepository.updateMarginBenchmarkRate(
      quotation.id,
      (percent / 100).toFixed(4),
    );
    return toCostMargin(updated);
  }

  async decide(
    actor: SessionUser,
    quotationId: string,
    action: HalfPackageApprovalDecision,
    reason: string | null,
  ): Promise<QuotationView> {
    this.accessPolicy.assertCanApproveQuotation(actor);
    if (action !== "APPROVED" && action !== "RETURNED") {
      throw new BadRequestException("审批操作仅支持批准或打回修改");
    }
    const current = await this.authorizedVersion(actor, quotationId);
    if (
      !current.isCurrent ||
      (current.status !== "QUOTED" &&
        !(action === "RETURNED" && current.status === "APPROVED")) ||
      (current.status === "QUOTED" &&
        current.adjustmentStatus !== "PENDING_APPROVAL")
    ) {
      throw new ConflictException(
        "主案设计师正在重新编辑报价单，请等再次确认生成后重新审批。",
      );
    }
    const normalizedReason = reason?.trim() || null;
    if (action === "RETURNED" && !normalizedReason) {
      throw new BadRequestException("打回修改必须填写原因");
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
    const auditAction =
      action === "RETURNED" ? "QUOTATION_RETURNED" : "QUOTATION_APPROVED";
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
      adjustmentStatus: version.adjustmentStatus,
      id: version.id,
      isCurrent: version.isCurrent,
      status: version.status,
      submittedAt: version.submittedAt?.toISOString() ?? null,
      total: version.adjustedTotal,
      versionNumber: version.versionNumber,
    }));
  }

  async continueEditing(
    actor: SessionUser,
    quotationId: string,
  ): Promise<QuotationView> {
    const source = await this.authorizedVersion(actor, quotationId);
    if (
      !source.isCurrent ||
      !["QUOTED", "RETURNED"].includes(source.status) ||
      (source.status === "QUOTED" &&
        source.adjustmentStatus === "PENDING_APPROVAL")
    ) {
      throw new ConflictException("仅当前已报价或已退回版本可继续编辑");
    }
    if (await this.quotationRepository.findDraft(source.projectId)) {
      throw new ConflictException("当前项目已有报价草稿");
    }
    const created = await this.quotationRepository.continueEditing(
      source,
      actor.id,
    );
    await this.auditRepository.append({
      action: "QUOTATION_EDITING_CONTINUED",
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

  async updateAdjustment(
    actor: SessionUser,
    quotationId: string,
    input: {
      readonly discountRate: string;
      readonly expectedRevision: number;
      readonly action: "SUBMIT_FOR_APPROVAL" | "CONFIRM";
      readonly reason: string | null;
      readonly writeOff: string;
    },
  ): Promise<QuotationView> {
    const quotation = await this.authorizedVersion(actor, quotationId);
    if (
      !quotation.isCurrent ||
      quotation.status !== "QUOTED" ||
      quotation.adjustmentStatus !== "AWAITING_SUBMISSION"
    ) {
      throw new ConflictException("仅当前已报价版本可设置折扣与抹零");
    }
    if (input.action === "CONFIRM") {
      this.accessPolicy.assertCanApproveQuotation(actor);
    } else if (input.action !== "SUBMIT_FOR_APPROVAL" || actor.role !== "LEAD_DESIGNER") {
      throw new BadRequestException("当前账号不能执行该折扣操作");
    }
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !/^0(?:\.\d{1,4})?$|^1(?:\.0{1,4})?$/.test(input.discountRate) ||
      !/^\d+(?:\.\d{1,4})?$/.test(input.writeOff)
    ) {
      throw new BadRequestException("折扣、抹零和修订号格式不正确");
    }
    const normalizedReason = input.reason?.trim() || null;
    if (!normalizedReason) {
      throw new BadRequestException("提交折扣审批必须填写调整原因");
    }
    const total = decimal4(quotation.total);
    const discountRate = decimal4(input.discountRate);
    const writeOff = decimal4(input.writeOff);
    const adjustedTotal = Math.max(0, total * discountRate - writeOff).toFixed(4);
    const grossProfit = (Number(adjustedTotal) - Number(quotation.expectedCost)).toFixed(4);
    const grossMarginRate = Number(adjustedTotal) === 0
      ? null
      : (Number(grossProfit) / Number(adjustedTotal)).toFixed(4);
    let saved: QuotationDraft;
    try {
      saved = input.action === "CONFIRM"
        ? await this.quotationRepository.decide(
            quotation.id,
            actor.id,
            "APPROVED",
            normalizedReason,
            {
              adjustedTotal,
              discountRate: input.discountRate,
              expectedRevision: input.expectedRevision,
              grossMarginRate,
              grossProfit,
              reason: normalizedReason,
              writeOff: input.writeOff,
            },
          )
        : await this.quotationRepository.saveAdjustment(
            quotation.id,
            input.discountRate,
            input.writeOff,
            adjustedTotal,
            grossProfit,
            grossMarginRate,
            actor.id,
            normalizedReason,
            input.expectedRevision,
          );
    } catch (error) {
      if (error instanceof QuotationRevisionConflictError) {
        throw new ConflictException("报价已变化，请刷新后重新设置折扣与抹零");
      }
      throw error;
    }
    await this.auditRepository.append({
      action:
        input.action === "CONFIRM"
          ? "QUOTATION_ADJUSTMENT_CONFIRMED"
          : "QUOTATION_ADJUSTMENT_SUBMITTED",
      actorUserId: actor.id,
      afterState: {
        discountRate: saved.discountRate,
        writeOff: saved.writeOff,
      },
      beforeState: {
        discountRate: quotation.discountRate,
        writeOff: quotation.writeOff,
      },
      occurredAt: new Date(),
      reason: normalizedReason,
      result: "SUCCESS",
      targetId: saved.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
    return toView(saved);
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
    const differences = compareQuotationVersions(
      from,
      to,
      actor.role === "ADMIN" || actor.role === "OWNER",
    );
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
    const exportable =
      quotation.isCurrent &&
      ((quotation.status === "QUOTED" &&
        quotation.adjustmentStatus === "AWAITING_SUBMISSION") ||
        (quotation.status === "APPROVED" &&
          quotation.adjustmentStatus === "CONFIRMED"));
    if (!exportable) {
      throw new ConflictException("当前报价状态不可导出客户版文件");
    }
    const project = await this.quotationRepository.findProject(quotation.projectId);
    if (!project) throw new NotFoundException("项目不存在");
    const generated = await this.exporter.generate(
      quotation,
      format,
      project.customerName,
    );
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
        quotationSpaceName(space.displayName, space.type, space.includesBalcony),
        space.id,
        space.type,
        space.area,
        space.perimeter,
        space.height,
        firstSortOrder + index,
        itemsForSpace(template.items, space.type, sectionCodes),
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
      discountRate: draft.discountRate,
      managementRate: draft.managementRate,
      outerFrameArea: draft.outerFrameArea,
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
      writeOff: draft.writeOff,
    });
    const calculatedScopes = new Map(
      result.scopes.map((scope) => [scope.id, scope] as const),
    );
    return {
      ...draft,
      adjustedTotal: result.adjustedTotal,
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
    scopes.push(
      buildScope(
        quotationSpaceName(space.displayName, space.type, space.includesBalcony),
        space.id,
        space.type,
        space.area,
        space.perimeter,
        space.height,
        scopes.length,
        itemsForSpace(template.items, space.type, sectionCodes),
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
    adjustmentReason: null,
    adjustmentStatus: "AWAITING_SUBMISSION",
    adjustedTotal: "0.0000",
    costTemplateVersionId: template.id,
    costTemplateVersionNumber: template.versionNumber,
    createdByUserId: actorUserId,
    directCost: "0.0000",
    discountRate: "1.0000",
    expectedCost: "0.0000",
    grossMarginRate: null,
    grossProfit: "0.0000",
    id: randomUUID(),
    isCurrent: true,
    managementFee: "0.0000",
    managementRate: "0.1000",
    marginBenchmarkRate: "0.3000",
    parentVersionId: null,
    projectId: project.id,
    outerFrameArea: project.outerFrameArea,
    projectAddress: project.projectAddress,
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
    writeOff: "0.0000",
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
  const linesWithRules: QuotationDraftLine[] = baseLines.map((line) => {
    const quantityRule = quantityRuleFor(line, baseLines);
    return {
      ...line,
      quantityRule,
      selected: quantityRule.kind !== "MANUAL",
    };
  });
  const lines = linesWithRules.map((line) => {
    if (line.quantityRule.kind !== "LINE_REFERENCE") return line;
    const referencedLineId = line.quantityRule.referencedLineId;
    return {
      ...line,
      selected:
        linesWithRules.find(
          (candidate) => candidate.id === referencedLineId,
        )?.selected ?? false,
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
    return { kind: "PROJECT_OUTER_FRAME_AREA" };
  }
  if (
    line.sectionCode === "ELECTRICAL" &&
    electricalBuildingAreaItems.has(line.itemName)
  ) {
    return { kind: "PROJECT_OUTER_FRAME_AREA" };
  }
  if (
    line.sectionCode === "OTHER" &&
    otherBuildingAreaItems.has(line.itemName)
  ) {
    return { kind: "PROJECT_OUTER_FRAME_AREA" };
  }
  if (
    (line.sectionCode === "LIVING_DINING" ||
      line.sectionCode === "BEDROOM") &&
    spaceAreaItemNames.has(line.itemName)
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
    sectionCode === "WALL" &&
    itemName === "石膏板隔墙隔音棉"
  ) {
    return "双面石膏板隔墙";
  }
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
  if (
    sectionCode === "KITCHEN_BATHROOM" &&
    itemName === "填充后细石砼地面找平"
  ) {
    return "下沉式卫生间地面填充";
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
      return ["KITCHEN_BATHROOM"];
    case "BATHROOM":
      return ["KITCHEN_BATHROOM"];
    case "BALCONY":
      return ["BALCONY"];
  }
}

function itemsForSpace(
  items: readonly QuotationTemplateItem[],
  spaceType: SpaceType,
  sectionCodes: readonly HalfPackageSectionCode[],
): readonly QuotationTemplateItem[] {
  return items.filter(
    (item) =>
      sectionCodes.includes(item.sectionCode) &&
      !(
        spaceType === "KITCHEN" &&
        (item.itemName === "下沉式淋浴房工艺" ||
          item.itemName === "壁龛工艺增加")
      ),
  );
}

function quotationSpaceName(
  displayName: string,
  spaceType: SpaceType,
  includesBalcony: boolean,
): string {
  return spaceType === "LIVING_DINING" && includesBalcony
    ? "客餐厅（包阳台）"
    : displayName;
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
    adjustmentReason: draft.adjustmentReason,
    adjustmentStatus: draft.adjustmentStatus,
    adjustedTotal: draft.adjustedTotal,
    directCost: draft.directCost,
    discountRate: draft.discountRate,
    id: draft.id,
    isCurrent: draft.isCurrent,
    managementFee: draft.managementFee,
    managementRate: draft.managementRate,
    projectId: draft.projectId,
    projectAddress: draft.projectAddress,
    revision: draft.revision,
    scopes: [
      ...draft.scopes.map((scope) => ({
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
      {
        area: null,
        height: null,
        id: `${draft.id}:management-fee`,
        lines: [
          {
            amount: draft.managementFee,
            id: `${draft.id}:management-fee-line`,
            itemName: "管理费",
            quantity: "1.0000",
            quantitySource: "MANUAL" as const,
            remarks: "按半包直接费 10% 自动计算",
            saleUnitPrice: draft.managementFee,
            sectionName: "管理费",
            selected: true,
            unit: "套",
          },
        ],
        name: "管理费",
        perimeter: null,
        projectSpaceId: null,
        spaceType: null,
        subtotal: draft.managementFee,
      },
    ],
    status: draft.status,
    submittedAt: draft.submittedAt?.toISOString() ?? null,
    templateVersion: draft.templateVersionNumber,
    total: draft.total,
    versionNumber: draft.versionNumber,
    writeOff: draft.writeOff,
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
    marginBenchmarkRate: draft.marginBenchmarkRate,
    projectId: draft.projectId,
    projectAddress: draft.projectAddress,
    salesAmount: draft.adjustedTotal,
    scopes: [
      ...draft.scopes.map((scope) => ({
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
      {
        expectedCost: "0.0000",
        grossMarginRate: draft.managementFee === "0.0000" ? null : "1.0000",
        grossProfit: draft.managementFee,
        id: `${draft.id}:management-fee`,
        lines: [
          {
            costAmount: "0.0000",
            costUnitPrice: "0.0000",
            grossMarginRate: "1.0000",
            grossProfit: draft.managementFee,
            id: `${draft.id}:management-fee-line`,
            itemName: "管理费",
            quantity: "1.0000",
            saleAmount: draft.managementFee,
            saleUnitPrice: draft.managementFee,
            unit: "套",
          },
        ],
        name: "管理费",
        salesAmount: draft.managementFee,
        spaceType: null,
      },
    ],
    status: draft.status,
    versionNumber: draft.versionNumber,
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
  includeCosts: boolean,
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
  const toLines = new Map(
    to.scopes.flatMap((scope) =>
      scope.lines.map((line) => [
        `${scope.projectSpaceId ?? scope.name}:${line.versionItemId}`,
        { line, scopeName: scope.name },
      ] as const),
    ),
  );
  for (const key of new Set([...fromLines.keys(), ...toLines.keys()])) {
    const previous = fromLines.get(key);
    const current = toLines.get(key);
    const fields: Array<
      readonly [
        HalfPackageVersionDifference["field"],
        string | null,
        string | null,
      ]
    > = [
      ["SELECTED", previous ? String(previous.line.selected) : null, current ? String(current.line.selected) : null],
      ["QUANTITY", previous?.line.calculatedQuantity ?? null, current?.line.calculatedQuantity ?? null],
      ["SALE_UNIT_PRICE", previous?.line.saleUnitPrice ?? null, current?.line.saleUnitPrice ?? null],
    ];
    if (includeCosts) {
      fields.push([
        "COST_UNIT_PRICE",
        previous?.line.costUnitPrice ?? null,
        current?.line.costUnitPrice ?? null,
      ]);
    }
    for (const [field, before, after] of fields) {
      if (before !== after) {
        differences.push({
          after,
          before,
          field,
          itemName: current?.line.itemName ?? previous?.line.itemName ?? "工程项",
          scopeName: current?.scopeName ?? previous?.scopeName ?? "项目",
        });
      }
    }
  }
  for (const [field, itemName, before, after] of [
    ["DISCOUNT_RATE", "折扣", from.discountRate, to.discountRate],
    ["WRITE_OFF", "抹零/减免", from.writeOff, to.writeOff],
    ["TOTAL", "报价合计", from.adjustedTotal, to.adjustedTotal],
  ] as const) {
    if (before !== after) {
      differences.push({
        after,
        before,
        field,
        itemName,
        scopeName: "项目",
      });
    }
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

const spaceAreaItemNames = new Set([
  "成品保护",
  "600*1200mm地砖（水泥砂浆粘贴）",
  "顶面基层处理",
]);

const otherBuildingAreaItems = new Set([
  "装潢垃圾清理费",
  "室内家政服务费",
]);

function decimal4(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException("金额格式不正确");
  }
  return parsed;
}
