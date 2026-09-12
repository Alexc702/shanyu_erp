import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  MainMaterialCategoryCode,
  MainMaterialCatalogFieldDifferenceView,
  MainMaterialCatalogLineDifferenceView,
  MainMaterialCatalogUpdateCheckView,
  MainMaterialImportBatchView,
  MainMaterialImportMode,
  MainMaterialItemView,
  MainMaterialQuotationView,
  PublishedMainMaterialCatalogView,
  SessionUser,
} from "@shanyu/contracts";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AccessPolicy } from "../access/access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../access/audit.repository";
import {
  PROJECTS_REPOSITORY,
  type ProjectsRepository,
} from "../project/projects.repository";
import {
  MAIN_MATERIAL_REPOSITORY,
  type MainMaterialCatalog,
  type MainMaterialImportBatch,
  type MainMaterialItem,
  type MainMaterialDelta,
  type MainMaterialQuotation,
  type MainMaterialRepository,
  MainMaterialRevisionConflictError,
  MainMaterialSelectionError,
} from "./main-material.repository";
import { parseMainMaterialWorkbook } from "./main-material-workbook";

const categoryOrder: readonly MainMaterialCategoryCode[] = [
  "TILE", "SEAM", "FLOOR", "GLASS_DOOR", "CEILING",
  "BATHROOM", "SHOWER", "STONE", "SWITCH", "CUSTOM",
];

const categoryNames: Readonly<Record<MainMaterialCategoryCode, string>> = {
  BATHROOM: "卫浴",
  CEILING: "集成吊顶",
  CUSTOM: "定制类",
  FLOOR: "木地板",
  GLASS_DOOR: "房门｜门套 - 玻璃门",
  SEAM: "美缝",
  SHOWER: "淋浴房",
  STONE: "石材｜岩板",
  SWITCH: "开关面板",
  TILE: "瓷砖",
};

@Injectable()
export class MainMaterialService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(MAIN_MATERIAL_REPOSITORY)
    private readonly repository: MainMaterialRepository,
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepository: ProjectsRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
  ) {}

  async getPublishedCatalog(
    actor: SessionUser,
    filters: {
      readonly categoryCode?: string;
      readonly query?: string;
      readonly spec?: string;
    } = {},
  ): Promise<PublishedMainMaterialCatalogView> {
    this.accessPolicy.assertCanReadCatalog(actor);
    const catalog = await this.repository.getPublishedCatalog();
    if (!catalog) throw new NotFoundException("当前没有已发布主材库");
    const manageable = actor.role === "ADMIN" || actor.role === "OWNER";
    const normalizedQuery = filters.query?.trim().toLowerCase() ?? "";
    const normalizedSpec = normalizeSpec(filters.spec ?? "");
    const items = catalog.items.filter((item) => {
      if (!manageable && item.status !== "ACTIVE") return false;
      if (filters.categoryCode && item.categoryCode !== filters.categoryCode) return false;
      if (normalizedSpec && normalizeSpec(item.spec) !== normalizedSpec) return false;
      return !normalizedQuery || [item.itemName, item.brand, item.series, item.model, item.spec]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
    return toCatalogView(catalog, items, manageable);
  }

  async getQuotation(
    actor: SessionUser,
    projectId: string,
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    const quotation = await this.repository.initializeAndSyncDraft(projectId)
      ?? await this.repository.getQuotationByProject(projectId);
    if (!quotation) {
      throw new ConflictException("请先保存半包报价，再开始主材选型");
    }
    return toQuotationView(quotation, canViewCosts(actor));
  }

  async getQuotationCatalog(
    actor: SessionUser,
    projectId: string,
  ): Promise<PublishedMainMaterialCatalogView> {
    await this.authorizedProject(actor, projectId);
    const quotation = await this.repository.initializeAndSyncDraft(projectId)
      ?? await this.repository.getQuotationByProject(projectId);
    if (!quotation) {
      throw new ConflictException("请先保存半包报价，再开始主材选型");
    }
    const catalog = await this.repository.getCatalogById(quotation.catalog.id);
    if (!catalog) throw new NotFoundException("项目绑定的主材库版本不存在");
    const items = catalog.items.filter((item) =>
      item.status === "ACTIVE" && item.salePrice !== null && item.costPrice !== null,
    );
    return toCatalogView(catalog, items, canViewCosts(actor));
  }

  async getVersion(
    actor: SessionUser,
    quotationId: string,
  ): Promise<MainMaterialQuotationView | null> {
    const quotation = await this.repository.getQuotationById(quotationId);
    if (!quotation) return null;
    await this.authorizedProject(actor, quotation.projectId);
    return toQuotationView(quotation, canViewCosts(actor));
  }

  async checkCatalogUpdate(
    actor: SessionUser,
    projectId: string,
  ): Promise<MainMaterialCatalogUpdateCheckView> {
    await this.authorizedProject(actor, projectId);
    const quotation = await this.repository.getQuotationByProject(projectId);
    if (!quotation) throw new ConflictException("请先保存半包报价，再开始主材选型");
    const latest = await this.repository.getPublishedCatalog();
    if (!latest) throw new ConflictException("当前没有已发布主材库");
    const updateAvailable = quotation.status === "DRAFT" && latest.id !== quotation.catalog.id;
    return {
      currentVersionNumber: quotation.catalog.versionNumber,
      differences: updateAvailable
        ? catalogDifferences(quotation, latest, canViewCosts(actor))
        : [],
      latestVersionNumber: latest.versionNumber,
      updateAvailable,
    };
  }

  async refreshCatalog(
    actor: SessionUser,
    projectId: string,
    expectedRevision: number,
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException("修订号格式不正确");
    }
    try {
      const before = await this.repository.getQuotationByProject(projectId);
      const quotation = await this.repository.refreshDraftCatalog({ expectedRevision, projectId });
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_CATALOG_REFRESHED",
        actorUserId: actor.id,
        afterState: {
          catalogVersion: quotation.catalog.versionNumber,
          revision: quotation.revision,
        },
        beforeState: before ? { catalogVersion: before.catalog.versionNumber } : null,
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: quotation.id,
        targetType: "MAIN_MATERIAL_QUOTATION",
      });
      return toQuotationView(quotation, canViewCosts(actor));
    } catch (error) {
      throw translateError(error);
    }
  }

  async selectLine(
    actor: SessionUser,
    projectId: string,
    lineId: string,
    input: {
      readonly color: string | null;
      readonly expectedRevision: number;
      readonly itemVersionId: string;
      readonly quantity?: string;
    },
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    validateSelectionInput(input);
    const quantity = input.quantity === undefined
      ? undefined
      : normalizeQuantity(input.quantity);
    try {
      const quotation = await this.repository.selectLine({
        ...input,
        color: input.color?.trim() || null,
        lineId,
        projectId,
        quantity,
      });
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_SELECTION_UPDATED",
        actorUserId: actor.id,
        afterState: { itemVersionId: input.itemVersionId, revision: quotation.revision },
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: lineId,
        targetType: "MAIN_MATERIAL_QUOTE_LINE",
      });
      return toQuotationView(quotation, canViewCosts(actor));
    } catch (error) {
      throw translateError(error);
    }
  }

  async updateDemandLine(
    actor: SessionUser,
    projectId: string,
    lineId: string,
    input: {
      readonly baseQuantity: string;
      readonly expectedRevision: number;
      readonly lossRate: string;
    },
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new BadRequestException("修订号格式不正确");
    }
    const baseQuantity = normalizeQuantity(input.baseQuantity);
    const lossRate = normalizeLossRate(input.lossRate);
    try {
      const quotation = await this.repository.updateDemandLine({
        baseQuantity,
        expectedRevision: input.expectedRevision,
        lineId,
        lossRate,
        projectId,
      });
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_SELECTION_UPDATED",
        actorUserId: actor.id,
        afterState: { baseQuantity, lossRate, revision: quotation.revision },
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: lineId,
        targetType: "MAIN_MATERIAL_QUOTE_LINE",
      });
      return toQuotationView(quotation, canViewCosts(actor));
    } catch (error) {
      throw translateError(error);
    }
  }

  async addManualLine(
    actor: SessionUser,
    projectId: string,
    input: {
      readonly categoryCode: MainMaterialCategoryCode;
      readonly color: string | null;
      readonly expectedRevision: number;
      readonly itemVersionId: string;
      readonly quantity: string;
    },
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    validateSelectionInput(input);
    if (input.categoryCode === "TILE" || !categoryOrder.includes(input.categoryCode)) {
      throw new BadRequestException("该分类由半包瓷砖需求自动生成");
    }
    try {
      const quotation = await this.repository.addManualLine({
        categoryCode: input.categoryCode,
        color: input.color?.trim() || null,
        expectedRevision: input.expectedRevision,
        id: randomUUID(),
        itemVersionId: input.itemVersionId,
        projectId,
        quantity: normalizeQuantity(input.quantity),
      });
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_LINE_ADDED",
        actorUserId: actor.id,
        afterState: { categoryCode: input.categoryCode, revision: quotation.revision },
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: quotation.id,
        targetType: "MAIN_MATERIAL_QUOTATION",
      });
      return toQuotationView(quotation, canViewCosts(actor));
    } catch (error) {
      throw translateError(error);
    }
  }

  async removeManualLine(
    actor: SessionUser,
    projectId: string,
    lineId: string,
    expectedRevision: number,
  ): Promise<MainMaterialQuotationView> {
    await this.authorizedProject(actor, projectId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException("修订号格式不正确");
    }
    try {
      const quotation = await this.repository.removeManualLine({
        expectedRevision,
        lineId,
        projectId,
      });
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_LINE_REMOVED",
        actorUserId: actor.id,
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: lineId,
        targetType: "MAIN_MATERIAL_QUOTE_LINE",
      });
      return toQuotationView(quotation, canViewCosts(actor));
    } catch (error) {
      throw translateError(error);
    }
  }

  async validateWorkbook(
    actor: SessionUser,
    input: {
      readonly buffer: Buffer;
      readonly fileName: string;
      readonly mode: MainMaterialImportMode;
    },
  ): Promise<MainMaterialImportBatchView> {
    this.accessPolicy.assertCanManageCatalog(actor);
    if (!/\.xlsx$/i.test(input.fileName)) {
      throw new BadRequestException("主材库导入仅支持 .xlsx 文件");
    }
    const hash = createHash("sha256").update(input.buffer).digest("hex");
    const existing = await this.repository.findImportBatchByHash(hash, input.mode);
    if (existing) return toBatchView(existing, true);
    let parsed;
    try {
      parsed = await parseMainMaterialWorkbook(input.buffer, input.mode);
    } catch {
      throw new BadRequestException("无法读取主材库 Excel，请检查文件是否损坏");
    }
    let validation = parsed.validation;
    if (input.mode === "DELTA" && validation.blockerCount === 0) {
      try {
        const checked = await this.repository.validateDelta(
          parsed.payload as readonly MainMaterialDelta[],
        );
        validation = { ...validation, pendingItemCount: checked.pendingItemCount };
      } catch (error) {
        const message = error instanceof MainMaterialRevisionConflictError
          ? "Delta 中存在记录版本冲突，请按当前版本重新生成变更文件"
          : error instanceof MainMaterialSelectionError
            ? error.message
            : "Delta 变更校验失败";
        validation = {
          ...validation,
          blockerCount: validation.blockerCount + 1,
          blockers: [...validation.blockers, message],
        };
      }
    }
    const batch = await this.repository.createImportBatch({
      createdByUserId: actor.id,
      fileHash: hash,
      fileName: input.fileName,
      id: randomUUID(),
      mode: input.mode,
      payload: parsed.payload,
      status: validation.blockerCount ? "FAILED" : "VALIDATED",
      validation: { ...validation },
    });
    await this.auditRepository.append({
      action: "MAIN_MATERIAL_IMPORT_VALIDATED",
      actorUserId: actor.id,
      afterState: { ...validation },
      occurredAt: new Date(),
      result: validation.blockerCount ? "FAILURE" : "SUCCESS",
      targetId: batch.id,
      targetType: "MAIN_MATERIAL_IMPORT_BATCH",
    });
    return toBatchView(batch, false);
  }

  async publishBatch(
    actor: SessionUser,
    batchId: string,
  ): Promise<PublishedMainMaterialCatalogView> {
    this.accessPolicy.assertCanManageCatalog(actor);
    try {
      const catalog = await this.repository.publishImportBatch(batchId, actor.id);
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_CATALOG_PUBLISHED",
        actorUserId: actor.id,
        afterState: { version: catalog.versionNumber },
        occurredAt: new Date(),
        result: "SUCCESS",
        targetId: catalog.id,
        targetType: "MAIN_MATERIAL_CATALOG_VERSION",
      });
      return toCatalogView(catalog, catalog.items, true);
    } catch (error) {
      throw translateError(error);
    }
  }

  async validateOnlineEdit(
    actor: SessionUser,
    input: {
      readonly changeReason: string;
      readonly expectedRecordVersion: number;
      readonly materialId: string;
      readonly operation: MainMaterialDelta["operation"];
      readonly values: Readonly<Record<string, string | null>>;
    },
  ): Promise<MainMaterialImportBatchView> {
    this.accessPolicy.assertCanManageCatalog(actor);
    const changeReason = input.changeReason.trim();
    if (!changeReason) throw new BadRequestException("请填写变更原因");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(input.materialId)) {
      throw new BadRequestException("material_id 格式不正确");
    }
    if (!Number.isSafeInteger(input.expectedRecordVersion) || input.expectedRecordVersion < 0) {
      throw new BadRequestException("记录版本格式不正确");
    }
    if (!(["UPSERT", "DEACTIVATE", "REACTIVATE"] as const).includes(input.operation)) {
      throw new BadRequestException("线上维护操作无效");
    }
    const allowedFields = new Set([
      "brand", "category_code", "category_name", "color", "cost_price",
      "data_status", "grade", "item_name", "lighting_power", "lock_type",
      "model", "packaging", "panel_size", "remarks", "sale_price", "series",
      "spec", "substrate", "thickness", "type", "unit", "wood_species",
    ]);
    const values = Object.fromEntries(
      Object.entries(input.values).filter(([field, value]) =>
        allowedFields.has(field) && (value === null || typeof value === "string"),
      ).map(([field, value]) => [field, typeof value === "string" ? value.trim() : value]),
    );
    const delta: MainMaterialDelta = {
      changeReason,
      expectedRecordVersion: input.expectedRecordVersion,
      materialId: input.materialId,
      operation: input.operation,
      values,
    };
    const checked = await this.repository.validateDelta([delta]);
    const hash = createHash("sha256")
      .update(JSON.stringify(delta))
      .digest("hex");
    const existing = await this.repository.findImportBatchByHash(hash, "DELTA");
    const batch = existing ?? await this.repository.createImportBatch({
      createdByUserId: actor.id,
      fileHash: hash,
      fileName: `线上维护-${input.materialId}`,
      id: randomUUID(),
      mode: "DELTA",
      payload: [delta],
      status: "VALIDATED",
      validation: {
        blockerCount: 0,
        blockers: [],
        itemCount: 1,
        pendingItemCount: checked.pendingItemCount,
        warningCount: 0,
        warnings: [],
      },
    });
    if (!existing) {
      await this.auditRepository.append({
        action: "MAIN_MATERIAL_ONLINE_EDIT_VALIDATED",
        actorUserId: actor.id,
        afterState: { materialId: input.materialId, operation: input.operation },
        occurredAt: new Date(),
        reason: changeReason,
        result: "SUCCESS",
        targetId: batch.id,
        targetType: "MAIN_MATERIAL_IMPORT_BATCH",
      });
    }
    return toBatchView(batch, Boolean(existing));
  }

  async readAsset(
    actor: SessionUser,
    assetId: string,
  ): Promise<{ readonly contentType: string; readonly fileName: string; readonly payload: Buffer }> {
    this.accessPolicy.assertCanReadCatalog(actor);
    if (!/^[a-f0-9]{64}$/.test(assetId)) throw new NotFoundException("图片不存在");
    const asset = await this.repository.findAsset(assetId);
    if (!asset) throw new NotFoundException("图片不存在");
    const candidates = [
      resolve(process.cwd(), "apps/api/assets", asset.storagePath),
      resolve(process.cwd(), "assets", asset.storagePath),
    ];
    for (const candidate of candidates) {
      try {
        return {
          contentType: asset.contentType,
          fileName: asset.fileName,
          payload: await readFile(candidate),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new NotFoundException("图片不存在");
  }

  private async authorizedProject(actor: SessionUser, projectId: string) {
    const project = await this.projectsRepository.findById(projectId);
    if (!project) throw new NotFoundException("项目不存在");
    this.accessPolicy.assertCanAccessProject(actor, project.leadDesigner.id);
    return project;
  }
}

function toCatalogView(
  catalog: MainMaterialCatalog,
  items: readonly MainMaterialItem[],
  includeCosts: boolean,
): PublishedMainMaterialCatalogView {
  return {
    categories: categoryOrder.map((code) => ({
      code,
      itemCount: items.filter((item) => item.categoryCode === code).length,
      name: categoryNames[code],
    })),
    id: catalog.id,
    items: items.map((item) => toItemView(item, includeCosts)),
    name: catalog.name,
    publishedAt: catalog.publishedAt.toISOString(),
    versionNumber: catalog.versionNumber,
  };
}

function catalogDifferences(
  quotation: MainMaterialQuotation,
  latest: MainMaterialCatalog,
  includeCosts: boolean,
): MainMaterialCatalogLineDifferenceView[] {
  const latestByMaterialId = new Map(latest.items.map((item) => [item.materialId, item]));
  const differences: MainMaterialCatalogLineDifferenceView[] = [];
  for (const line of quotation.lines) {
    if (!line.materialId) continue;
    const item = latestByMaterialId.get(line.materialId);
    const reason = refreshBlocker(line, item);
    if (reason) {
      differences.push({
        demandName: line.demandName,
        fields: [],
        lineId: line.id,
        materialId: line.materialId,
        reason,
        status: "UNAVAILABLE",
      });
      continue;
    }
    if (!item) continue;
    const fields: MainMaterialCatalogFieldDifferenceView[] = [];
    addDifference(fields, "brand", "品牌", line.brand ?? "", item.brand);
    addDifference(fields, "series", "系列 / 工艺", line.series ?? "", item.series);
    addDifference(fields, "model", "型号", line.model ?? "", item.model);
    addDifference(fields, "spec", "规格", line.spec ?? "", item.spec);
    addDifference(fields, "colors", "可选颜色", line.colors.join("、"), item.colors.join("、"));
    addDifference(fields, "unit", "单位", line.unit ?? "", item.unit);
    addDifference(fields, "salePrice", "销售价", line.saleUnitPrice ?? "", item.salePrice ?? "");
    if (includeCosts) {
      addDifference(fields, "costPrice", "成本价", line.costUnitPrice ?? "", item.costPrice ?? "");
    }
    if (line.assetIds.join(",") !== item.assetIds.join(",")) {
      fields.push({
        after: `${item.assetIds.length} 张`,
        before: `${line.assetIds.length} 张`,
        field: "assets",
        label: "产品图",
      });
    }
    if (fields.length) {
      differences.push({
        demandName: line.demandName,
        fields,
        lineId: line.id,
        materialId: line.materialId,
        reason: null,
        status: "UPDATED",
      });
    }
  }
  return differences;
}

function refreshBlocker(
  line: MainMaterialQuotation["lines"][number],
  item: MainMaterialItem | undefined,
): string | null {
  if (!item) return "新版本中已删除";
  if (item.status !== "ACTIVE") return "新版本中已停用或转为待补资料";
  if (!item.salePrice || !item.costPrice) return "新版本中价格资料不完整";
  if (item.categoryCode !== line.categoryCode) return "新版本中的商品分类已变化";
  if (line.origin === "AUTO_TILE" && (
    normalizeSpec(item.spec) !== normalizeSpec(line.demandSpec) ||
    !["m2", "m²", "㎡"].includes(item.unit.trim().toLowerCase())
  )) return "新版本中的规格或单位与当前瓷砖需求不兼容";
  if (item.colors.length && (!line.selectedColor || !item.colors.includes(line.selectedColor))) {
    return "原选颜色在新版本中不可用";
  }
  if (!item.colors.length && line.selectedColor) return "新版本不再提供颜色选项";
  return null;
}

function addDifference(
  target: MainMaterialCatalogFieldDifferenceView[],
  field: string,
  label: string,
  before: string,
  after: string,
): void {
  if (before === after) return;
  target.push({ after: after || "—", before: before || "—", field, label });
}

function toItemView(item: MainMaterialItem, includeCosts: boolean): MainMaterialItemView {
  return {
    assets: item.assetIds.map((id) => ({ id, path: `/catalog/main-materials/assets/${id}` })),
    attributes: item.attributes,
    brand: item.brand,
    categoryCode: item.categoryCode,
    categoryName: item.categoryName,
    colors: item.colors,
    ...(includeCosts ? { costPrice: item.costPrice } : {}),
    id: item.id,
    itemName: item.itemName,
    materialId: item.materialId,
    missingFields: item.missingFields,
    model: item.model,
    ...(includeCosts
      ? {
          priceDerivation: item.priceDerivation ?? "",
          sourceFile: item.sourceFile ?? "",
          sourceRow: item.sourceRow ?? "",
          sourceSheet: item.sourceSheet ?? "",
        }
      : {}),
    recordVersion: item.recordVersion,
    remarks: includeCosts ? item.remarks : "",
    salePrice: item.salePrice,
    series: item.series,
    spec: item.spec,
    status: item.status,
    unit: item.unit,
  };
}

function toQuotationView(
  quotation: MainMaterialQuotation,
  includeCosts: boolean,
): MainMaterialQuotationView {
  const grossProfit = subtract(quotation.total, quotation.expectedCost);
  return {
    catalogVersion: quotation.catalog,
    id: quotation.id,
    lines: quotation.lines.map((line) => ({
      amount: line.saleAmount,
      baseQuantity: line.baseQuantity,
      categoryCode: line.categoryCode,
      ...(includeCosts ? { costAmount: line.costAmount } : {}),
      demandName: line.demandName,
      demandSpec: line.demandSpec,
      id: line.id,
      item: line.itemVersionId && line.materialId && line.itemName && line.brand !== null &&
          line.series !== null && line.model !== null && line.spec !== null && line.unit &&
          line.saleUnitPrice
        ? {
            assets: line.assetIds.map((id) => ({ id, path: `/catalog/main-materials/assets/${id}` })),
            brand: line.brand,
            colors: line.colors,
            ...(includeCosts && line.costUnitPrice ? { costUnitPrice: line.costUnitPrice } : {}),
            itemName: line.itemName,
            materialId: line.materialId,
            model: line.model,
            saleUnitPrice: line.saleUnitPrice,
            series: line.series,
            spec: line.spec,
            unit: line.unit,
          }
        : null,
      lossRate: line.lossRate,
      origin: line.origin,
      quantity: line.quantity,
      scopeName: line.scopeName,
      selectedColor: line.selectedColor,
    })),
    projectId: quotation.projectId,
    revision: quotation.revision,
    status: quotation.status,
    summary: {
      directCost: quotation.directCost,
      ...(includeCosts
        ? {
            expectedCost: quotation.expectedCost,
            grossMarginRate: rate(grossProfit, quotation.total),
            grossProfit,
          }
        : {}),
      managementFee: quotation.managementFee,
      total: quotation.total,
    },
  };
}

function toBatchView(
  batch: MainMaterialImportBatch,
  reused: boolean,
): MainMaterialImportBatchView {
  return {
    createdAt: batch.createdAt.toISOString(),
    fileName: batch.fileName,
    id: batch.id,
    mode: batch.mode,
    publishedVersionId: batch.publishedVersionId,
    reused,
    status: batch.status,
    validation: batch.validation as unknown as MainMaterialImportBatchView["validation"],
  };
}

function validateSelectionInput(input: {
  readonly expectedRevision: number;
  readonly itemVersionId: string;
}): void {
  if (
    !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 ||
    typeof input.itemVersionId !== "string" || !input.itemVersionId
  ) {
    throw new BadRequestException("主材选型信息不完整");
  }
}

function normalizeQuantity(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized) || decimal4Units(normalized) <= 0n) {
    throw new BadRequestException("数量必须大于 0，且最多保留 4 位小数");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}.${fraction.padEnd(4, "0")}`;
}

function normalizeLossRate(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    throw new BadRequestException("损耗率必须在 0% 到 100% 之间，且最多保留 4 位小数");
  }
  const units = decimal4Units(normalized);
  if (units < 0n || units > 10_000n) {
    throw new BadRequestException("损耗率必须在 0% 到 100% 之间，且最多保留 4 位小数");
  }
  return fixed4(units);
}

function normalizeSpec(value: string): string {
  return value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
}

function canViewCosts(actor: SessionUser): boolean {
  return actor.role === "ADMIN" || actor.role === "OWNER";
}

function translateError(error: unknown): Error {
  if (error instanceof MainMaterialRevisionConflictError) {
    return new ConflictException("主材报价已变化，请刷新后重试");
  }
  if (error instanceof MainMaterialSelectionError) {
    return new BadRequestException(error.message);
  }
  return error instanceof Error ? error : new Error("主材操作失败");
}

function subtract(left: string, right: string): string {
  return fixed4(decimal4Units(left) - decimal4Units(right));
}

function rate(numerator: string, denominator: string): string | null {
  const denominatorUnits = decimal4Units(denominator);
  if (denominatorUnits === 0n) return null;
  return fixed4(divideRounded(decimal4Units(numerator) * 10_000n, denominatorUnits));
}

function decimal4Units(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new BadRequestException("金额或数量格式不正确");
  const units = BigInt(match[2] ?? "0") * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -units : units;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const left = numerator < 0n ? -numerator : numerator;
  const right = denominator < 0n ? -denominator : denominator;
  const quotient = (left + right / 2n) / right;
  return negative ? -quotient : quotient;
}

function fixed4(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  return `${sign}${absolute / 10_000n}.${String(absolute % 10_000n).padStart(4, "0")}`;
}
