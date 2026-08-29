import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  HalfPackageCostMargin,
  HalfPackageSectionCode,
  ProjectDetail,
  SessionUser,
  SpaceType,
} from "@shanyu/contracts";
import { randomUUID } from "node:crypto";

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
  type QuotationRepository,
  QuotationRevisionConflictError,
  type QuotationTemplate,
  type QuotationTemplateItem,
} from "./quotation.repository";

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
  readonly status: "DRAFT";
  readonly templateVersion: number;
  readonly total: string;
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
    await this.getOrCreateDraft(actor, projectId);
    const draft = await this.quotationRepository.findDraft(projectId);
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
    projectId: project.id,
    projectName: project.name,
    revision: 0,
    ruleVersionId: template.ruleVersionId,
    scopes,
    status: "DRAFT",
    templateVersionId: template.id,
    templateVersionNumber: template.versionNumber,
    total: "0.0000",
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
      return ["BALCONY"];
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
    templateVersion: draft.templateVersionNumber,
    total: draft.total,
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
