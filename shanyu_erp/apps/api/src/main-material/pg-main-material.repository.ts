import { Injectable } from "@nestjs/common";
import type {
  MainMaterialCategoryCode,
  MainMaterialDataStatus,
} from "@shanyu/contracts";
import { randomUUID } from "node:crypto";

import {
  DatabaseClient,
  type DatabaseExecutor,
} from "../database/database.client";
import {
  type MainMaterialAsset,
  type MainMaterialCatalog,
  type MainMaterialDelta,
  type MainMaterialImportBatch,
  type MainMaterialItem,
  type MainMaterialQuotation,
  type MainMaterialQuoteLine,
  type MainMaterialRepository,
  MainMaterialRevisionConflictError,
  MainMaterialSelectionError,
  type NewMainMaterialImportBatch,
  type NormalizedMainMaterialItem,
} from "./main-material.repository";

interface CatalogRow {
  id: string;
  name: string;
  published_at: Date;
  version_number: number;
}

interface ItemRow {
  asset_ids: string[];
  attributes: Record<string, string>;
  brand: string;
  catalog_version_id: string;
  category_code: MainMaterialCategoryCode;
  category_name: string;
  colors: string[];
  cost_price: string | null;
  data_status: MainMaterialDataStatus;
  id: string;
  item_name: string;
  material_id: string;
  missing_fields: string;
  model: string;
  price_derivation: string;
  record_version: number;
  remarks: string;
  sale_price: string | null;
  series: string;
  source_file: string;
  source_row: string;
  source_sheet: string;
  spec: string;
  unit: string;
}

interface ImportRow {
  created_at: Date;
  created_by_user_id: string;
  file_hash: string;
  file_name: string;
  id: string;
  mode: "FULL" | "DELTA";
  normalized_payload: NormalizedMainMaterialItem[] | MainMaterialDelta[];
  published_version_id: string | null;
  status: "FAILED" | "VALIDATED" | "PUBLISHED";
  validation_report: Record<string, unknown>;
}

interface QuotationRow {
  catalog_id: string;
  catalog_name: string;
  catalog_version_number: number;
  id: string;
  main_material_direct_cost: string;
  main_material_expected_cost: string;
  main_material_management_fee: string;
  main_material_total: string;
  project_id: string;
  revision: number;
  status: MainMaterialQuotation["status"];
}

interface QuoteLineRow {
  asset_ids: string[];
  base_quantity: string | null;
  brand: string | null;
  category_code: MainMaterialCategoryCode;
  colors: string[];
  cost_amount: string | null;
  cost_unit_price: string | null;
  demand_name: string;
  demand_spec: string;
  id: string;
  item_name: string | null;
  item_version_id: string | null;
  loss_rate: string;
  material_id: string | null;
  model: string | null;
  origin: "AUTO_TILE" | "MANUAL";
  quote_quantity: string;
  sale_amount: string | null;
  sale_unit_price: string | null;
  scope_name: string;
  selected_color: string | null;
  series: string | null;
  spec: string | null;
  unit: string | null;
}

interface DesiredDemandRow {
  base_quantity: string;
  demand_name: string;
  demand_spec: string;
  line_id: string;
  scope_name: string;
  sort_order: number;
}

@Injectable()
export class PgMainMaterialRepository implements MainMaterialRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getPublishedCatalog(): Promise<MainMaterialCatalog | null> {
    const catalogResult = await this.database.query<CatalogRow>(
      `${catalogSelect} WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    const catalog = catalogResult.rows[0];
    if (!catalog) return null;
    const items = await this.listItems(this.database, catalog.id);
    return toCatalog(catalog, items);
  }

  async findItem(itemVersionId: string): Promise<MainMaterialItem | null> {
    const result = await this.database.query<ItemRow>(
      `${itemSelect} WHERE i.id = $1`,
      [itemVersionId],
    );
    return result.rows[0] ? toItem(result.rows[0]) : null;
  }

  async findAsset(assetId: string): Promise<MainMaterialAsset | null> {
    const result = await this.database.query<{
      content_type: string;
      file_name: string;
      id: string;
      storage_path: string;
    }>(
      `SELECT id, content_type, file_name, storage_path
         FROM main_material_assets
        WHERE id = $1`,
      [assetId],
    );
    const row = result.rows[0];
    return row
      ? {
          contentType: row.content_type,
          fileName: row.file_name,
          id: row.id,
          storagePath: row.storage_path,
        }
      : null;
  }

  async createImportBatch(
    input: NewMainMaterialImportBatch,
  ): Promise<MainMaterialImportBatch> {
    await this.database.query(
      `INSERT INTO main_material_import_batches
         (id, mode, file_name, file_hash, status, validation_report,
          normalized_payload, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        input.id,
        input.mode,
        input.fileName,
        input.fileHash,
        input.status,
        JSON.stringify(input.validation),
        JSON.stringify(input.payload),
        input.createdByUserId,
      ],
    );
    const created = await this.findImportBatch(input.id);
    if (!created) throw new Error("创建主材导入批次后无法读取结果");
    return created;
  }

  findImportBatch(batchId: string): Promise<MainMaterialImportBatch | null> {
    return this.findBatch("id = $1", [batchId]);
  }

  findImportBatchByHash(
    fileHash: string,
    mode: "FULL" | "DELTA",
  ): Promise<MainMaterialImportBatch | null> {
    return this.findBatch("file_hash = $1 AND mode = $2", [fileHash, mode]);
  }

  async publishImportBatch(
    batchId: string,
    actorUserId: string,
  ): Promise<MainMaterialCatalog> {
    const versionId = await this.database.transaction(async (database) => {
      const batchResult = await database.query<ImportRow>(
        `${importSelect} WHERE id = $1 FOR UPDATE`,
        [batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) throw new MainMaterialSelectionError("主材导入批次不存在");
      if (batch.status === "PUBLISHED" && batch.published_version_id) {
        return batch.published_version_id;
      }
      const blockerCount = Number(batch.validation_report.blockerCount ?? 0);
      if (batch.status !== "VALIDATED" || blockerCount > 0) {
        throw new MainMaterialSelectionError("导入校验存在阻断项，不能发布");
      }
      const currentResult = await database.query<CatalogRow>(
        `${catalogSelect} WHERE status = 'PUBLISHED' FOR UPDATE`,
      );
      const current = currentResult.rows[0];
      if (!current) throw new MainMaterialSelectionError("当前没有已发布主材库");
      const currentItems = await this.listItems(database, current.id);
      const normalized = batch.mode === "FULL"
        ? (batch.normalized_payload as NormalizedMainMaterialItem[])
        : applyDelta(
            currentItems.map(toNormalizedItem),
            batch.normalized_payload as MainMaterialDelta[],
          );
      const nextVersionResult = await database.query<{ next_version: number }>(
        `SELECT coalesce(max(version_number), 0) + 1 AS next_version
           FROM main_material_catalog_versions`,
      );
      const versionNumber = nextVersionResult.rows[0]?.next_version ?? 1;
      const id = randomUUID();
      await database.query(
        `INSERT INTO main_material_catalog_versions
           (id, version_number, name, status, source_type, source_file,
            source_hash, validation_report, created_by_user_id, validated_at)
         VALUES ($1, $2, $3, 'VALIDATED', $4, $5, $6, $7::jsonb, $8,
                 current_timestamp)`,
        [
          id,
          versionNumber,
          `山屿 ERP 主材库 V${versionNumber}`,
          batch.mode,
          batch.file_name,
          batch.file_hash,
          JSON.stringify(batch.validation_report),
          actorUserId,
        ],
      );
      for (const item of normalized) {
        await insertItem(database, id, item);
      }
      await database.query(
        `INSERT INTO main_material_item_assets
           (catalog_version_id, material_id, asset_id, sort_order)
         SELECT $1, next.material_id, old.asset_id, old.sort_order
           FROM main_material_item_versions next
           JOIN main_material_item_assets old
             ON old.catalog_version_id = $2
            AND old.material_id = next.material_id
          WHERE next.catalog_version_id = $1`,
        [id, current.id],
      );
      await database.query(
        `UPDATE main_material_catalog_versions
            SET status = 'SUPERSEDED'
          WHERE id = $1 AND status = 'PUBLISHED'`,
        [current.id],
      );
      await database.query(
        `UPDATE main_material_catalog_versions
            SET status = 'PUBLISHED', published_at = current_timestamp
          WHERE id = $1 AND status = 'VALIDATED'`,
        [id],
      );
      await database.query(
        `UPDATE main_material_import_batches
            SET status = 'PUBLISHED', published_version_id = $2
          WHERE id = $1 AND status = 'VALIDATED'`,
        [batchId, id],
      );
      return id;
    });
    const result = await this.database.query<CatalogRow>(
      `${catalogSelect} WHERE id = $1`,
      [versionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("发布主材库版本后无法读取结果");
    return toCatalog(row, await this.listItems(this.database, row.id));
  }

  async validateDelta(
    changes: readonly MainMaterialDelta[],
  ): Promise<{ readonly pendingItemCount: number }> {
    const current = await this.getPublishedCatalog();
    if (!current) throw new MainMaterialSelectionError("当前没有已发布主材库");
    const normalized = applyDelta(current.items.map(toNormalizedItem), changes);
    return {
      pendingItemCount: normalized.filter((item) => item.status === "PENDING_DATA").length,
    };
  }

  getQuotationByProject(projectId: string): Promise<MainMaterialQuotation | null> {
    return this.findQuotation("q.project_id = $1 AND q.is_current", [projectId]);
  }

  getQuotationById(quotationId: string): Promise<MainMaterialQuotation | null> {
    return this.findQuotation("q.id = $1", [quotationId]);
  }

  async initializeAndSyncDraft(
    projectId: string,
  ): Promise<MainMaterialQuotation | null> {
    await this.database.transaction(async (database) => {
      const quotationResult = await database.query<{
        id: string;
        main_material_catalog_version_id: string | null;
        status: string;
      }>(
        `SELECT id, status, main_material_catalog_version_id
           FROM half_package_quotations
          WHERE project_id = $1 AND is_current
          FOR UPDATE`,
        [projectId],
      );
      const quotation = quotationResult.rows[0];
      if (!quotation || quotation.status !== "DRAFT") return;
      let changed = false;
      if (!quotation.main_material_catalog_version_id) {
        const attached = await database.query(
          `UPDATE half_package_quotations
              SET main_material_catalog_version_id = catalog.id
             FROM main_material_catalog_versions catalog
            WHERE half_package_quotations.id = $1
              AND catalog.status = 'PUBLISHED'`,
          [quotation.id],
        );
        if (attached.rowCount !== 1) {
          throw new MainMaterialSelectionError("当前没有可用于选型的已发布主材库");
        }
        changed = true;
      }
      const desiredResult = await database.query<DesiredDemandRow>(
        `SELECT l.id AS line_id, qs.name AS scope_name,
                l.item_name AS demand_name, tag.target_spec AS demand_spec,
                l.calculated_quantity AS base_quantity,
                qs.sort_order * 1000 + l.sort_order AS sort_order
           FROM half_package_quotation_lines l
           JOIN half_package_quotation_spaces qs ON qs.id = l.quotation_space_id
           JOIN half_package_version_items vi ON vi.id = l.version_item_id
           JOIN half_package_main_material_demand_tags tag
             ON tag.standard_item_id = vi.standard_item_id
          WHERE qs.quotation_id = $1
            AND l.selected
            AND l.calculated_quantity > 0
          ORDER BY qs.sort_order, l.sort_order`,
        [quotation.id],
      );
      const desiredIds = desiredResult.rows.map((row) => row.line_id);
      const removed = await database.query(
        `DELETE FROM main_material_quote_lines
          WHERE quotation_id = $1 AND origin = 'AUTO_TILE'
            AND NOT (source_half_package_line_id = ANY($2::uuid[]))`,
        [quotation.id, desiredIds],
      );
      changed ||= Boolean(removed.rowCount);
      for (const demand of desiredResult.rows) {
        const existing = await database.query<{ id: string; base_quantity: string }>(
          `SELECT id, base_quantity
             FROM main_material_quote_lines
            WHERE quotation_id = $1 AND source_half_package_line_id = $2`,
          [quotation.id, demand.line_id],
        );
        const quoteQuantity = await multipliedQuantity(database, demand.base_quantity, "1.1500");
        if (!existing.rows[0]) {
          await database.query(
            `INSERT INTO main_material_quote_lines
               (id, quotation_id, origin, source_half_package_line_id,
                category_code, scope_name, demand_name, demand_spec,
                base_quantity, loss_rate, quote_quantity, sort_order)
             VALUES ($1, $2, 'AUTO_TILE', $3, 'TILE', $4, $5, $6,
                     $7, 0.1500, $8, $9)`,
            [
              randomUUID(), quotation.id, demand.line_id, demand.scope_name,
              demand.demand_name, demand.demand_spec, demand.base_quantity,
              quoteQuantity, demand.sort_order,
            ],
          );
          changed = true;
        } else if (existing.rows[0].base_quantity !== demand.base_quantity) {
          await database.query(
            `UPDATE main_material_quote_lines
                SET scope_name = $3, demand_name = $4, demand_spec = $5,
                    base_quantity = $6, quote_quantity = $7,
                    sale_amount = CASE WHEN sale_unit_price IS NULL THEN NULL
                      ELSE round($7::numeric * sale_unit_price, 4) END,
                    cost_amount = CASE WHEN cost_unit_price IS NULL THEN NULL
                      ELSE round($7::numeric * cost_unit_price, 4) END,
                    sort_order = $8
              WHERE quotation_id = $1 AND source_half_package_line_id = $2`,
            [
              quotation.id, demand.line_id, demand.scope_name, demand.demand_name,
              demand.demand_spec, demand.base_quantity, quoteQuantity,
              demand.sort_order,
            ],
          );
          changed = true;
        }
      }
      if (changed) await recalculateQuotation(database, quotation.id, true);
    });
    return this.getQuotationByProject(projectId);
  }

  async refreshDraftCatalog(input: {
    readonly expectedRevision: number;
    readonly projectId: string;
  }): Promise<MainMaterialQuotation> {
    await this.database.transaction(async (database) => {
      const quotation = await lockQuotation(database, input.projectId, input.expectedRevision);
      const latestResult = await database.query<CatalogRow>(
        `${catalogSelect} WHERE status = 'PUBLISHED' LIMIT 1 FOR SHARE`,
      );
      const latest = latestResult.rows[0];
      if (!latest) throw new MainMaterialSelectionError("当前没有已发布主材库");
      if (latest.id === quotation.mainMaterialCatalogVersionId) return;

      const linesResult = await database.query<QuoteLineRow>(
        `${quoteLineSelect} WHERE quotation_id = $1 ORDER BY sort_order, id FOR UPDATE`,
        [quotation.id],
      );
      for (const line of linesResult.rows) {
        if (!line.material_id) continue;
        const itemResult = await database.query<ItemRow>(
          `${itemSelect} WHERE i.catalog_version_id = $1 AND i.material_id = $2 LIMIT 1`,
          [latest.id, line.material_id],
        );
        const item = itemResult.rows[0] ? toItem(itemResult.rows[0]) : null;
        if (!item || !canRefreshSelection(line, item)) {
          await clearQuoteLineSelection(database, quotation.id, line.id);
          continue;
        }
        await updateQuoteLineSnapshot(database, quotation.id, line, item);
      }
      await database.query(
        `UPDATE half_package_quotations
            SET main_material_catalog_version_id = $2
          WHERE id = $1`,
        [quotation.id, latest.id],
      );
      await recalculateQuotation(database, quotation.id, true);
    });
    return this.requiredQuotation(input.projectId);
  }

  async selectLine(input: {
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly itemVersionId: string;
    readonly lineId: string;
    readonly projectId: string;
    readonly quantity?: string;
  }): Promise<MainMaterialQuotation> {
    await this.database.transaction(async (database) => {
      const context = await lockSelectionContext(database, input.projectId, input.lineId, input.expectedRevision);
      const item = await findItem(database, input.itemVersionId, context.quotationId);
      assertCompatible(context.line, item, input.color);
      const quantity = context.line.origin === "MANUAL"
        ? input.quantity ?? context.line.quote_quantity
        : context.line.quote_quantity;
      await database.query(
        `UPDATE main_material_quote_lines
            SET item_version_id = $3, material_id = $4, item_name = $5,
                brand = $6, series = $7, model = $8, spec = $9,
                selected_color = $10, unit = $11, sale_unit_price = $12,
                cost_unit_price = $13, quote_quantity = $14,
                sale_amount = round($14::numeric * $12::numeric, 4),
                cost_amount = round($14::numeric * $13::numeric, 4),
                asset_ids = $15::jsonb
          WHERE quotation_id = $1 AND id = $2`,
        [
          context.quotationId, input.lineId, item.id, item.materialId,
          item.itemName, item.brand, item.series, item.model, item.spec,
          input.color, item.unit, item.salePrice, item.costPrice, quantity,
          JSON.stringify(item.assetIds),
        ],
      );
      await recalculateQuotation(database, context.quotationId, true);
    });
    return this.requiredQuotation(input.projectId);
  }

  async addManualLine(input: {
    readonly categoryCode: Exclude<MainMaterialCategoryCode, "TILE">;
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly id: string;
    readonly itemVersionId: string;
    readonly projectId: string;
    readonly quantity: string;
  }): Promise<MainMaterialQuotation> {
    await this.database.transaction(async (database) => {
      const quotation = await lockQuotation(database, input.projectId, input.expectedRevision);
      const item = await findItem(database, input.itemVersionId, quotation.id);
      if (item.categoryCode !== input.categoryCode) {
        throw new MainMaterialSelectionError("所选商品与主材分类不匹配");
      }
      assertColor(item, input.color);
      const orderResult = await database.query<{ next_order: number }>(
        `SELECT coalesce(max(sort_order), 0) + 1 AS next_order
           FROM main_material_quote_lines WHERE quotation_id = $1`,
        [quotation.id],
      );
      await database.query(
        `INSERT INTO main_material_quote_lines
           (id, quotation_id, origin, category_code, scope_name, demand_name,
            demand_spec, base_quantity, loss_rate, quote_quantity,
            item_version_id, material_id, item_name, brand, series, model,
            spec, selected_color, unit, sale_unit_price, cost_unit_price,
            sale_amount, cost_amount, asset_ids, sort_order)
         VALUES ($1, $2, 'MANUAL', $3, '项目级', $4, $5, NULL, 0,
                 $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, round($6::numeric * $16::numeric, 4),
                 round($6::numeric * $17::numeric, 4), $18::jsonb, $19)`,
        [
          input.id, quotation.id, input.categoryCode,
          item.itemName || item.model, item.spec, input.quantity, item.id,
          item.materialId, item.itemName, item.brand, item.series, item.model,
          item.spec, input.color, item.unit, item.salePrice, item.costPrice,
          JSON.stringify(item.assetIds), orderResult.rows[0]?.next_order ?? 1,
        ],
      );
      await recalculateQuotation(database, quotation.id, true);
    });
    return this.requiredQuotation(input.projectId);
  }

  async removeManualLine(input: {
    readonly expectedRevision: number;
    readonly lineId: string;
    readonly projectId: string;
  }): Promise<MainMaterialQuotation> {
    await this.database.transaction(async (database) => {
      const quotation = await lockQuotation(database, input.projectId, input.expectedRevision);
      const removed = await database.query(
        `DELETE FROM main_material_quote_lines
          WHERE quotation_id = $1 AND id = $2 AND origin = 'MANUAL'`,
        [quotation.id, input.lineId],
      );
      if (removed.rowCount !== 1) throw new MainMaterialSelectionError("主材报价行不存在");
      await recalculateQuotation(database, quotation.id, true);
    });
    return this.requiredQuotation(input.projectId);
  }

  private async requiredQuotation(projectId: string): Promise<MainMaterialQuotation> {
    const quotation = await this.getQuotationByProject(projectId);
    if (!quotation) throw new Error("保存主材报价后无法读取结果");
    return quotation;
  }

  private async findQuotation(
    where: string,
    values: readonly unknown[],
  ): Promise<MainMaterialQuotation | null> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect} WHERE ${where} AND q.main_material_catalog_version_id IS NOT NULL LIMIT 1`,
      values,
    );
    const row = result.rows[0];
    if (!row) return null;
    const lines = await this.database.query<QuoteLineRow>(
      `${quoteLineSelect} WHERE quotation_id = $1 ORDER BY sort_order, id`,
      [row.id],
    );
    return toQuotation(row, lines.rows.map(toQuoteLine));
  }

  private async findBatch(
    where: string,
    values: readonly unknown[],
  ): Promise<MainMaterialImportBatch | null> {
    const result = await this.database.query<ImportRow>(
      `${importSelect} WHERE ${where} LIMIT 1`,
      values,
    );
    return result.rows[0] ? toBatch(result.rows[0]) : null;
  }

  private async listItems(
    database: DatabaseExecutor,
    catalogVersionId: string,
  ): Promise<MainMaterialItem[]> {
    const result = await database.query<ItemRow>(
      `${itemSelect} WHERE i.catalog_version_id = $1
       ORDER BY i.category_code, i.brand, i.series, i.model, i.material_id`,
      [catalogVersionId],
    );
    return result.rows.map(toItem);
  }
}

const catalogSelect = `SELECT id, version_number, name, published_at
  FROM main_material_catalog_versions`;

const itemSelect = `SELECT i.id, i.catalog_version_id, i.material_id,
    i.category_code, i.category_name, i.item_name, i.brand, i.series,
    i.model, i.spec, i.colors, i.unit, i.sale_price, i.cost_price,
    i.attributes, i.data_status, i.record_version, i.missing_fields,
    i.remarks, i.source_file, i.source_sheet, i.source_row, i.price_derivation,
    coalesce((SELECT jsonb_agg(a.asset_id ORDER BY a.sort_order)
      FROM main_material_item_assets a
      WHERE a.catalog_version_id = i.catalog_version_id
        AND a.material_id = i.material_id), '[]'::jsonb) AS asset_ids
  FROM main_material_item_versions i`;

const importSelect = `SELECT id, mode, file_name, file_hash, status,
    validation_report, normalized_payload, created_by_user_id,
    published_version_id, created_at
  FROM main_material_import_batches`;

const quotationSelect = `SELECT q.id, q.project_id, q.status, q.revision,
    q.main_material_direct_cost, q.main_material_management_fee,
    q.main_material_total, q.main_material_expected_cost,
    catalog.id AS catalog_id, catalog.name AS catalog_name,
    catalog.version_number AS catalog_version_number
  FROM half_package_quotations q
  JOIN main_material_catalog_versions catalog
    ON catalog.id = q.main_material_catalog_version_id`;

const quoteLineSelect = `SELECT id, origin, category_code, scope_name,
    demand_name, demand_spec, base_quantity, loss_rate, quote_quantity,
    item_version_id, material_id, item_name, brand, series, model, spec,
    selected_color, unit, sale_unit_price, cost_unit_price, sale_amount,
    cost_amount, asset_ids,
    coalesce((SELECT colors FROM main_material_item_versions item
      WHERE item.id = main_material_quote_lines.item_version_id), '[]'::jsonb) AS colors
  FROM main_material_quote_lines`;

function toCatalog(row: CatalogRow, items: readonly MainMaterialItem[]): MainMaterialCatalog {
  return {
    id: row.id,
    items,
    name: row.name,
    publishedAt: row.published_at,
    versionNumber: row.version_number,
  };
}

function toItem(row: ItemRow): MainMaterialItem {
  return {
    assetIds: row.asset_ids,
    attributes: row.attributes,
    brand: row.brand,
    catalogVersionId: row.catalog_version_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    colors: row.colors,
    costPrice: row.cost_price,
    id: row.id,
    itemName: row.item_name,
    materialId: row.material_id,
    missingFields: row.missing_fields,
    model: row.model,
    priceDerivation: row.price_derivation,
    recordVersion: row.record_version,
    remarks: row.remarks,
    salePrice: row.sale_price,
    series: row.series,
    sourceFile: row.source_file,
    sourceRow: row.source_row,
    sourceSheet: row.source_sheet,
    spec: row.spec,
    status: row.data_status,
    unit: row.unit,
  };
}

function toQuoteLine(row: QuoteLineRow): MainMaterialQuoteLine {
  return {
    assetIds: row.asset_ids,
    baseQuantity: row.base_quantity,
    brand: row.brand,
    categoryCode: row.category_code,
    colors: row.colors,
    costAmount: row.cost_amount,
    costUnitPrice: row.cost_unit_price,
    demandName: row.demand_name,
    demandSpec: row.demand_spec,
    id: row.id,
    itemName: row.item_name,
    itemVersionId: row.item_version_id,
    lossRate: row.loss_rate,
    materialId: row.material_id,
    model: row.model,
    origin: row.origin,
    quantity: row.quote_quantity,
    saleAmount: row.sale_amount,
    saleUnitPrice: row.sale_unit_price,
    scopeName: row.scope_name,
    selectedColor: row.selected_color,
    series: row.series,
    spec: row.spec,
    unit: row.unit,
  };
}

function toQuotation(
  row: QuotationRow,
  lines: readonly MainMaterialQuoteLine[],
): MainMaterialQuotation {
  return {
    catalog: {
      id: row.catalog_id,
      name: row.catalog_name,
      versionNumber: row.catalog_version_number,
    },
    directCost: row.main_material_direct_cost,
    expectedCost: row.main_material_expected_cost,
    id: row.id,
    lines,
    managementFee: row.main_material_management_fee,
    projectId: row.project_id,
    revision: row.revision,
    status: row.status,
    total: row.main_material_total,
  };
}

function toBatch(row: ImportRow): MainMaterialImportBatch {
  return {
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    fileHash: row.file_hash,
    fileName: row.file_name,
    id: row.id,
    mode: row.mode,
    payload: row.normalized_payload,
    publishedVersionId: row.published_version_id,
    status: row.status,
    validation: row.validation_report,
  };
}

function toNormalizedItem(item: MainMaterialItem): NormalizedMainMaterialItem {
  return {
    attributes: item.attributes,
    brand: item.brand,
    categoryCode: item.categoryCode,
    categoryName: item.categoryName,
    colors: item.colors,
    costPrice: item.costPrice,
    itemName: item.itemName,
    materialId: item.materialId,
    missingFields: item.missingFields,
    model: item.model,
    priceDerivation: item.priceDerivation,
    recordVersion: item.recordVersion,
    remarks: item.remarks,
    salePrice: item.salePrice,
    series: item.series,
    sourceFile: item.sourceFile,
    sourceRow: item.sourceRow,
    sourceSheet: item.sourceSheet,
    spec: item.spec,
    status: item.status,
    unit: item.unit,
  };
}

function applyDelta(
  source: readonly NormalizedMainMaterialItem[],
  changes: readonly MainMaterialDelta[],
): NormalizedMainMaterialItem[] {
  const items = new Map(source.map((item) => [item.materialId, item] as const));
  for (const change of changes) {
    const current = items.get(change.materialId);
    if (!current) {
      if (change.operation !== "UPSERT" || change.expectedRecordVersion !== 0) {
        throw new MainMaterialSelectionError(`主材 ${change.materialId} 不存在`);
      }
      const created = normalizeSelectableState(createDeltaItem(change));
      validatePublishedItem(created);
      items.set(change.materialId, created);
      continue;
    }
    if (current.recordVersion !== change.expectedRecordVersion) {
      throw new MainMaterialRevisionConflictError();
    }
    const values = change.values;
    const attributes = { ...current.attributes };
    const attributeFields: Readonly<Record<string, string>> = {
      grade: "grade", lighting_power: "lightingPower", lock_type: "lockType",
      packaging: "packaging", panel_size: "panelSize", substrate: "substrate",
      thickness: "thickness", type: "type", wood_species: "woodSpecies",
    };
    for (const [field, key] of Object.entries(attributeFields)) {
      if (field in values) attributes[key] = values[field] ?? "";
    }
    const next = normalizeSelectableState({
      ...current,
      attributes,
      brand: deltaText(values, "brand", current.brand),
      categoryCode: deltaText(values, "category_code", current.categoryCode) as MainMaterialCategoryCode,
      categoryName: deltaText(values, "category_name", current.categoryName),
      colors: "color" in values ? splitColors(values.color) : current.colors,
      costPrice: deltaMoney(values, "cost_price", current.costPrice),
      itemName: deltaText(values, "item_name", current.itemName),
      model: deltaText(values, "model", current.model),
      recordVersion: current.recordVersion + 1,
      remarks: deltaText(values, "remarks", current.remarks),
      salePrice: deltaMoney(values, "sale_price", current.salePrice),
      series: deltaText(values, "series", current.series),
      spec: deltaText(values, "spec", current.spec),
      status: change.operation === "DEACTIVATE"
        ? "INACTIVE"
        : change.operation === "REACTIVATE"
          ? "ACTIVE"
          : deltaText(values, "data_status", current.status) as MainMaterialDataStatus,
      unit: deltaText(values, "unit", current.unit),
    });
    validatePublishedItem(next);
    items.set(change.materialId, next);
  }
  return [...items.values()];
}

function createDeltaItem(change: MainMaterialDelta): NormalizedMainMaterialItem {
  const values = change.values;
  const categoryCode = deltaText(values, "category_code", "");
  const status = deltaText(values, "data_status", "PENDING_DATA");
  if (!isMainMaterialCategory(categoryCode)) {
    throw new MainMaterialSelectionError(`${change.materialId} 分类代码无效`);
  }
  if (!isMainMaterialStatus(status)) {
    throw new MainMaterialSelectionError(`${change.materialId} 数据状态无效`);
  }
  const attributeFields: Readonly<Record<string, string>> = {
    grade: "grade", lighting_power: "lightingPower", lock_type: "lockType",
    packaging: "packaging", panel_size: "panelSize", substrate: "substrate",
    thickness: "thickness", type: "type", wood_species: "woodSpecies",
  };
  const attributes: Record<string, string> = {};
  for (const [field, key] of Object.entries(attributeFields)) {
    attributes[key] = values[field] ?? "";
  }
  return {
    attributes,
    brand: deltaText(values, "brand", ""),
    categoryCode,
    categoryName: deltaText(values, "category_name", categoryCode),
    colors: splitColors(values.color),
    costPrice: deltaMoney(values, "cost_price", null),
    itemName: deltaText(values, "item_name", ""),
    materialId: change.materialId,
    missingFields: "",
    model: deltaText(values, "model", ""),
    priceDerivation: "",
    recordVersion: 1,
    remarks: deltaText(values, "remarks", ""),
    salePrice: deltaMoney(values, "sale_price", null),
    series: deltaText(values, "series", ""),
    sourceFile: "ERP 在线编辑",
    sourceRow: "",
    sourceSheet: "",
    spec: deltaText(values, "spec", ""),
    status,
    unit: deltaText(values, "unit", ""),
  };
}

function deltaText(
  values: Readonly<Record<string, string | null>>,
  field: string,
  fallback: string,
): string {
  return field in values ? values[field] ?? "" : fallback;
}

function deltaMoney(
  values: Readonly<Record<string, string | null>>,
  field: string,
  fallback: string | null,
): string | null {
  if (!(field in values)) return fallback;
  const value = values[field];
  if (value === null) return null;
  if (value === undefined) return fallback;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new MainMaterialSelectionError(`${field} 格式无效`);
  }
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function splitColors(value: string | null | undefined): string[] {
  return (value ?? "").split(/[；;]/).map((part) => part.trim()).filter(Boolean);
}

function validatePublishedItem(item: NormalizedMainMaterialItem): void {
  if (!isMainMaterialCategory(item.categoryCode)) {
    throw new MainMaterialSelectionError(`${item.materialId} 分类代码无效`);
  }
  if (!isMainMaterialStatus(item.status)) {
    throw new MainMaterialSelectionError(`${item.materialId} 数据状态无效`);
  }
  if (!item.itemName && !item.model) throw new MainMaterialSelectionError(`${item.materialId} 缺少品名/型号`);
  if (!item.unit) throw new MainMaterialSelectionError(`${item.materialId} 缺少单位`);
  if (item.status === "ACTIVE" && (!item.salePrice || !item.costPrice)) {
    throw new MainMaterialSelectionError(`${item.materialId} 缺少销售价或成本价`);
  }
  if (item.status === "ACTIVE" && item.categoryCode === "TILE" && (!item.brand || !item.spec)) {
    throw new MainMaterialSelectionError(`${item.materialId} 的 ACTIVE 瓷砖缺少品牌或规格`);
  }
}

function normalizeSelectableState(
  item: NormalizedMainMaterialItem,
): NormalizedMainMaterialItem {
  const required: string[] = [];
  if (!item.itemName && !item.model) required.push("品名/型号");
  if (!item.unit) required.push("单位");
  if (!item.salePrice) required.push("销售价");
  if (!item.costPrice) required.push("成本价");
  if (item.categoryCode === "TILE" && !item.brand) required.push("品牌");
  if (item.categoryCode === "TILE" && !item.spec) required.push("规格");
  const managedFields = new Set(["品名/型号", "单位", "销售价", "成本价", "品牌", "规格"]);
  const retained = item.missingFields
    .split(/[、；;]/)
    .map((value) => value.trim())
    .filter((value) => value && !managedFields.has(value));
  return {
    ...item,
    missingFields: [...new Set([...retained, ...required])].join("、"),
    status: item.status !== "INACTIVE" && required.length ? "PENDING_DATA" : item.status,
  };
}

function isMainMaterialCategory(value: string): value is MainMaterialCategoryCode {
  return ["TILE", "SEAM", "FLOOR", "GLASS_DOOR", "CEILING", "BATHROOM", "SHOWER", "STONE", "SWITCH", "CUSTOM"].includes(value);
}

function isMainMaterialStatus(value: string): value is MainMaterialDataStatus {
  return value === "ACTIVE" || value === "PENDING_DATA" || value === "INACTIVE";
}

async function insertItem(
  database: DatabaseExecutor,
  catalogVersionId: string,
  sourceItem: NormalizedMainMaterialItem,
): Promise<void> {
  const item = normalizeSelectableState(sourceItem);
  validatePublishedItem(item);
  await database.query(
    `INSERT INTO main_material_item_versions
       (id, catalog_version_id, material_id, category_code, category_name,
        item_name, brand, series, model, spec, colors, unit, sale_price,
        cost_price, attributes, data_status, record_version, missing_fields,
        source_file, source_sheet, source_row, price_derivation, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
             $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23)`,
    [
      randomUUID(), catalogVersionId, item.materialId, item.categoryCode,
      item.categoryName, item.itemName, item.brand, item.series, item.model,
      item.spec, JSON.stringify(item.colors), item.unit, item.salePrice,
      item.costPrice, JSON.stringify(item.attributes), item.status,
      item.recordVersion, item.missingFields, item.sourceFile ?? "",
      item.sourceSheet ?? "", item.sourceRow ?? "", item.priceDerivation ?? "",
      item.remarks,
    ],
  );
}

async function lockQuotation(
  database: DatabaseExecutor,
  projectId: string,
  expectedRevision: number,
): Promise<{ id: string; mainMaterialCatalogVersionId: string }> {
  const result = await database.query<{ id: string; main_material_catalog_version_id: string }>(
    `SELECT id, main_material_catalog_version_id FROM half_package_quotations
      WHERE project_id = $1 AND is_current AND status = 'DRAFT'
        AND revision = $2 AND main_material_catalog_version_id IS NOT NULL
      FOR UPDATE`,
    [projectId, expectedRevision],
  );
  if (!result.rows[0]) throw new MainMaterialRevisionConflictError();
  return {
    id: result.rows[0].id,
    mainMaterialCatalogVersionId: result.rows[0].main_material_catalog_version_id,
  };
}

function canRefreshSelection(line: QuoteLineRow, item: MainMaterialItem): boolean {
  if (item.status !== "ACTIVE" || !item.salePrice || !item.costPrice) return false;
  try {
    assertCompatible(line, item, line.selected_color);
    return true;
  } catch {
    return false;
  }
}

async function clearQuoteLineSelection(
  database: DatabaseExecutor,
  quotationId: string,
  lineId: string,
): Promise<void> {
  await database.query(
    `UPDATE main_material_quote_lines
        SET item_version_id = NULL, material_id = NULL, item_name = NULL,
            brand = NULL, series = NULL, model = NULL, spec = NULL,
            selected_color = NULL, unit = NULL, sale_unit_price = NULL,
            cost_unit_price = NULL, sale_amount = NULL, cost_amount = NULL,
            asset_ids = '[]'::jsonb
      WHERE quotation_id = $1 AND id = $2`,
    [quotationId, lineId],
  );
}

async function updateQuoteLineSnapshot(
  database: DatabaseExecutor,
  quotationId: string,
  line: QuoteLineRow,
  item: MainMaterialItem,
): Promise<void> {
  await database.query(
    `UPDATE main_material_quote_lines
        SET item_version_id = $3, material_id = $4, item_name = $5,
            brand = $6, series = $7, model = $8, spec = $9,
            unit = $10, sale_unit_price = $11, cost_unit_price = $12,
            sale_amount = round(quote_quantity * $11::numeric, 4),
            cost_amount = round(quote_quantity * $12::numeric, 4),
            asset_ids = $13::jsonb
      WHERE quotation_id = $1 AND id = $2`,
    [
      quotationId, line.id, item.id, item.materialId, item.itemName,
      item.brand, item.series, item.model, item.spec, item.unit,
      item.salePrice, item.costPrice, JSON.stringify(item.assetIds),
    ],
  );
}

async function lockSelectionContext(
  database: DatabaseExecutor,
  projectId: string,
  lineId: string,
  expectedRevision: number,
): Promise<{ line: QuoteLineRow; quotationId: string }> {
  const quotation = await lockQuotation(database, projectId, expectedRevision);
  const result = await database.query<QuoteLineRow>(
    `${quoteLineSelect} WHERE quotation_id = $1 AND id = $2 FOR UPDATE`,
    [quotation.id, lineId],
  );
  const line = result.rows[0];
  if (!line) throw new MainMaterialSelectionError("主材需求行不存在");
  return { line, quotationId: quotation.id };
}

async function findItem(
  database: DatabaseExecutor,
  itemVersionId: string,
  quotationId: string,
): Promise<MainMaterialItem> {
  const result = await database.query<ItemRow>(
    `${itemSelect}
      JOIN half_package_quotations q
        ON q.main_material_catalog_version_id = i.catalog_version_id
       AND q.status = 'DRAFT' AND q.is_current
     WHERE i.id = $1 AND q.id = $2 AND i.data_status = 'ACTIVE'
       AND i.sale_price IS NOT NULL AND i.cost_price IS NOT NULL`,
    [itemVersionId, quotationId],
  );
  if (!result.rows[0]) throw new MainMaterialSelectionError("该商品当前不可用于选型");
  return toItem(result.rows[0]);
}

function assertCompatible(
  line: QuoteLineRow,
  item: MainMaterialItem,
  color: string | null,
): void {
  if (line.category_code !== item.categoryCode) {
    throw new MainMaterialSelectionError("所选商品与需求分类不匹配");
  }
  if (line.origin === "AUTO_TILE") {
    if (normalizeSpec(line.demand_spec) !== normalizeSpec(item.spec) || !isSquareMeter(item.unit)) {
      throw new MainMaterialSelectionError("瓷砖规格或单位与半包需求不匹配");
    }
  }
  assertColor(item, color);
}

function assertColor(item: MainMaterialItem, color: string | null): void {
  if (item.colors.length && (!color || !item.colors.includes(color))) {
    throw new MainMaterialSelectionError("请选择该商品提供的有效颜色");
  }
  if (!item.colors.length && color) {
    throw new MainMaterialSelectionError("该商品没有可选颜色");
  }
}

function normalizeSpec(value: string): string {
  return value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
}

function isSquareMeter(value: string): boolean {
  return ["m2", "m²", "㎡"].includes(value.trim().toLowerCase());
}

async function multipliedQuantity(
  database: DatabaseExecutor,
  quantity: string,
  multiplier: string,
): Promise<string> {
  const result = await database.query<{ value: string }>(
    `SELECT round($1::numeric * $2::numeric, 4) AS value`,
    [quantity, multiplier],
  );
  return result.rows[0]?.value ?? "0.0000";
}

async function recalculateQuotation(
  database: DatabaseExecutor,
  quotationId: string,
  incrementRevision: boolean,
): Promise<void> {
  await database.query(
    `WITH totals AS (
       SELECT coalesce(sum(sale_amount), 0)::numeric(16,4) AS direct_cost,
              coalesce(sum(cost_amount), 0)::numeric(16,4) AS expected_cost
         FROM main_material_quote_lines
        WHERE quotation_id = $1
     )
     UPDATE half_package_quotations q
        SET main_material_direct_cost = totals.direct_cost,
            main_material_management_fee = round(totals.direct_cost * 0.1000, 4),
            main_material_total = round(totals.direct_cost * 1.1000, 4),
            main_material_expected_cost = totals.expected_cost,
            adjusted_total = greatest(round(
              (q.total + round(totals.direct_cost * 1.1000, 4))
              * q.discount_rate - q.write_off, 4), 0),
            gross_profit = round(greatest(round(
              (q.total + round(totals.direct_cost * 1.1000, 4))
              * q.discount_rate - q.write_off, 4), 0)
              - q.expected_cost - totals.expected_cost, 4),
            gross_margin_rate = CASE WHEN greatest(round(
              (q.total + round(totals.direct_cost * 1.1000, 4))
              * q.discount_rate - q.write_off, 4), 0) = 0 THEN NULL
              ELSE round((greatest(round(
                (q.total + round(totals.direct_cost * 1.1000, 4))
                * q.discount_rate - q.write_off, 4), 0)
                - q.expected_cost - totals.expected_cost) /
                greatest(round((q.total + round(totals.direct_cost * 1.1000, 4))
                * q.discount_rate - q.write_off, 4), 0), 4) END,
            revision = revision + CASE WHEN $2::boolean THEN 1 ELSE 0 END,
            updated_at = current_timestamp
       FROM totals
      WHERE q.id = $1`,
    [quotationId, incrementRevision],
  );
}
