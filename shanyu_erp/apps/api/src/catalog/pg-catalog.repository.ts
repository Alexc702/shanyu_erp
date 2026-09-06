import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import {
  DatabaseClient,
  type DatabaseExecutor,
} from "../database/database.client";
import {
  CatalogBatchStateError,
  type CatalogImportBatch,
  type CatalogImportStatus,
  type CatalogRepository,
  type NewCatalogImportBatch,
  type PublishedHalfPackageCatalog,
} from "./catalog.repository";
import type {
  HalfPackageWorkbookItem,
  HalfPackageWorkbookSection,
} from "./half-package-workbook";

interface BatchRow {
  created_at: Date;
  created_by_user_id: string;
  file_hash: string;
  file_name: string;
  id: string;
  published_version_id: string | null;
  status: CatalogImportStatus;
  validation_report: NewCatalogImportBatch["validation"];
}

interface ImportSectionRow {
  code: HalfPackageWorkbookSection["code"];
  id: string;
  item_count: number;
  name: string;
  sort_order: number;
}

interface ImportItemRow {
  cost_unit_price: string | null;
  id: string;
  item_name: string;
  quantity_formula: string | null;
  raw_quantity: string | null;
  remarks: string | null;
  sale_unit_price: string | null;
  section_code: HalfPackageWorkbookSection["code"];
  section_id: string;
  section_name: string;
  sort_order: number;
  source_row: number;
  unit: string;
}

interface PublishedVersionRow {
  id: string;
  published_at: Date;
  version_number: number;
}

interface PublishedItemRow {
  cost_unit_price: string;
  id: string;
  item_name: string;
  quantity_formula: string | null;
  raw_quantity: string | null;
  remarks: string | null;
  sale_unit_price: string;
  section_name: string;
  sort_order: number;
  source_row: number;
  unit: string;
}

@Injectable()
export class PgCatalogRepository implements CatalogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findImportBatchByHash(
    fileHash: string,
  ): Promise<CatalogImportBatch | null> {
    const result = await this.database.query<BatchRow>(
      `${batchSelect} WHERE file_hash = $1`,
      [fileHash],
    );
    return result.rows[0]
      ? this.hydrateBatch(this.database, result.rows[0])
      : null;
  }

  async createImportBatch(
    input: NewCatalogImportBatch,
  ): Promise<CatalogImportBatch> {
    await this.database.transaction(async (database) => {
      await database.query(
        `INSERT INTO catalog_import_batches
           (id, file_name, file_hash, source_sheet, status,
            validation_report, created_by_user_id)
         VALUES ($1, $2, $3, '半包报价模板', $4, $5::jsonb, $6)`,
        [
          input.id,
          input.fileName,
          input.fileHash,
          input.status,
          JSON.stringify(input.validation),
          input.createdByUserId,
        ],
      );
      for (const section of input.sections) {
        const sectionId = randomUUID();
        await database.query(
          `INSERT INTO catalog_import_sections
             (id, batch_id, code, name, sort_order, item_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sectionId,
            input.id,
            section.code,
            section.name,
            section.sortOrder,
            section.itemCount,
          ],
        );
        for (const item of input.items.filter(
          (candidate) => candidate.sectionName === section.name,
        )) {
          await database.query(
            `INSERT INTO catalog_import_items
               (id, section_id, source_row, sort_order, item_name, unit,
                raw_quantity, quantity_formula, sale_unit_price,
                cost_unit_price, remarks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              randomUUID(),
              sectionId,
              item.sourceRow,
              item.sortOrder,
              item.itemName,
              item.unit,
              item.rawQuantity,
              item.quantityFormula,
              item.saleUnitPrice || null,
              item.costUnitPrice || null,
              item.remarks,
            ],
          );
        }
      }
    });
    const batch = await this.findImportBatchById(input.id);
    if (!batch) {
      throw new Error("创建主材库导入批次后无法读取结果");
    }
    return batch;
  }

  async findImportBatchById(
    batchId: string,
  ): Promise<CatalogImportBatch | null> {
    const result = await this.database.query<BatchRow>(
      `${batchSelect} WHERE id = $1`,
      [batchId],
    );
    return result.rows[0]
      ? this.hydrateBatch(this.database, result.rows[0])
      : null;
  }

  async publishImportBatch(
    batchId: string,
    publishedByUserId: string,
  ): Promise<PublishedHalfPackageCatalog> {
    const versionId = await this.database.transaction(async (database) => {
      const batchResult = await database.query<BatchRow>(
        `${batchSelect} WHERE id = $1 FOR UPDATE`,
        [batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch || batch.status !== "VALIDATED") {
        throw new CatalogBatchStateError();
      }
      const sections = await this.readImportSections(database, batchId);
      const items = await this.readImportItems(database, batchId);

      await database.query(
        "LOCK TABLE half_package_template_versions IN EXCLUSIVE MODE",
      );
      const versionResult = await database.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
           FROM half_package_template_versions`,
      );
      const versionNumber = versionResult.rows[0]?.next_version ?? 1;
      const newVersionId = randomUUID();
      await database.query(
        `INSERT INTO half_package_template_versions
           (id, version_number, source_batch_id, published_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [newVersionId, versionNumber, batchId, publishedByUserId],
      );

      const publishedSectionIds = new Map<string, string>();
      for (const section of sections) {
        const sectionId = randomUUID();
        publishedSectionIds.set(section.id, sectionId);
        await database.query(
          `INSERT INTO half_package_sections
             (id, template_version_id, code, name, sort_order, item_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sectionId,
            newVersionId,
            section.code,
            section.name,
            section.sort_order,
            section.item_count,
          ],
        );
      }

      const occurrences = new Map<string, number>();
      for (const item of items) {
        if (!item.sale_unit_price || !item.cost_unit_price) {
          throw new CatalogBatchStateError();
        }
        const sectionId = publishedSectionIds.get(item.section_id);
        if (!sectionId) {
          throw new Error("导入工程项缺少报价分区");
        }
        const baseKey = stableItemBaseKey(item);
        const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
        occurrences.set(baseKey, occurrence);
        const catalogKey = `${baseKey}:${occurrence}`;
        const standardResult = await database.query<{ id: string }>(
          `INSERT INTO standard_engineering_items (id, catalog_key)
           VALUES ($1, $2)
           ON CONFLICT (catalog_key)
           DO UPDATE SET catalog_key = EXCLUDED.catalog_key
           RETURNING id`,
          [randomUUID(), catalogKey],
        );
        const standardItemId = standardResult.rows[0]?.id;
        if (!standardItemId) {
          throw new Error("无法建立稳定工程项身份");
        }
        const versionItemId = randomUUID();
        await database.query(
          `INSERT INTO half_package_version_items
             (id, template_version_id, section_id, standard_item_id,
              source_import_item_id, item_name, unit, raw_quantity,
              quantity_formula, remarks, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            versionItemId,
            newVersionId,
            sectionId,
            standardItemId,
            item.id,
            item.item_name,
            item.unit,
            item.raw_quantity,
            item.quantity_formula,
            item.remarks,
            item.sort_order,
          ],
        );
        await database.query(
          `INSERT INTO half_package_item_price_versions
             (id, version_item_id, sale_unit_price, cost_unit_price)
           VALUES ($1, $2, $3, $4)`,
          [
            randomUUID(),
            versionItemId,
            item.sale_unit_price,
            item.cost_unit_price,
          ],
        );
      }

      await database.query(
        `UPDATE half_package_quotation_lines draft_line
            SET remarks = latest_item.remarks
           FROM half_package_quotation_spaces scope,
                half_package_quotations quotation,
                half_package_version_items original_item,
                half_package_version_items latest_item
          WHERE scope.id = draft_line.quotation_space_id
            AND quotation.id = scope.quotation_id
            AND quotation.status = 'DRAFT'
            AND quotation.is_current
            AND original_item.id = draft_line.version_item_id
            AND latest_item.template_version_id = $1
            AND latest_item.standard_item_id = original_item.standard_item_id
            AND draft_line.remarks IS DISTINCT FROM latest_item.remarks`,
        [newVersionId],
      );

      await database.query(
        `UPDATE catalog_import_batches
            SET status = 'PUBLISHED', published_version_id = $2
          WHERE id = $1`,
        [batchId, newVersionId],
      );
      return newVersionId;
    });

    const catalog = await this.getCatalogById(versionId);
    if (!catalog) {
      throw new Error("发布主材库版本后无法读取结果");
    }
    return catalog;
  }

  async getPublishedCatalog(): Promise<PublishedHalfPackageCatalog | null> {
    const result = await this.database.query<PublishedVersionRow>(
      `SELECT id, version_number, published_at
         FROM half_package_template_versions
        ORDER BY version_number DESC
        LIMIT 1`,
    );
    return result.rows[0]
      ? this.hydratePublishedCatalog(this.database, result.rows[0])
      : null;
  }

  private async getCatalogById(
    versionId: string,
  ): Promise<PublishedHalfPackageCatalog | null> {
    const result = await this.database.query<PublishedVersionRow>(
      `SELECT id, version_number, published_at
         FROM half_package_template_versions
        WHERE id = $1`,
      [versionId],
    );
    return result.rows[0]
      ? this.hydratePublishedCatalog(this.database, result.rows[0])
      : null;
  }

  private async hydrateBatch(
    database: DatabaseExecutor,
    row: BatchRow,
  ): Promise<CatalogImportBatch> {
    const sections = await this.readImportSections(database, row.id);
    const items = await this.readImportItems(database, row.id);
    return {
      createdAt: row.created_at,
      createdByUserId: row.created_by_user_id,
      fileHash: row.file_hash.trim(),
      fileName: row.file_name,
      id: row.id,
      items: items.map(toWorkbookItem),
      publishedVersionId: row.published_version_id,
      sections: sections.map(toWorkbookSection),
      status: row.status,
      validation: row.validation_report,
    };
  }

  private async hydratePublishedCatalog(
    database: DatabaseExecutor,
    row: PublishedVersionRow,
  ): Promise<PublishedHalfPackageCatalog> {
    const sectionsResult = await database.query<ImportSectionRow>(
      `SELECT id, code, name, sort_order, item_count
         FROM half_package_sections
        WHERE template_version_id = $1
        ORDER BY sort_order, id`,
      [row.id],
    );
    const itemsResult = await database.query<PublishedItemRow>(
      `SELECT vi.item_name, vi.unit, vi.raw_quantity, vi.quantity_formula,
              vi.remarks, vi.sort_order, vi.standard_item_id AS id,
              cis.name AS section_name,
              ci.source_row, pv.sale_unit_price, pv.cost_unit_price
         FROM half_package_version_items vi
         JOIN half_package_sections cis ON cis.id = vi.section_id
         JOIN catalog_import_items ci ON ci.id = vi.source_import_item_id
         JOIN half_package_item_price_versions pv ON pv.version_item_id = vi.id
        WHERE vi.template_version_id = $1
        ORDER BY vi.sort_order, vi.id`,
      [row.id],
    );
    return {
      id: row.id,
      items: itemsResult.rows.map((item) => ({
        costUnitPrice: item.cost_unit_price,
        id: item.id,
        itemName: item.item_name,
        quantityFormula: item.quantity_formula,
        rawQuantity: item.raw_quantity,
        remarks: item.remarks,
        saleUnitPrice: item.sale_unit_price,
        sectionName: item.section_name,
        sortOrder: item.sort_order,
        sourceRow: item.source_row,
        unit: item.unit,
      })),
      publishedAt: row.published_at,
      sections: sectionsResult.rows.map((section) => ({
        ...toWorkbookSection(section),
        id: section.id,
      })),
      versionNumber: row.version_number,
    };
  }

  private async readImportSections(
    database: DatabaseExecutor,
    batchId: string,
  ): Promise<ImportSectionRow[]> {
    const result = await database.query<ImportSectionRow>(
      `SELECT id, code, name, sort_order, item_count
         FROM catalog_import_sections
        WHERE batch_id = $1
        ORDER BY sort_order, id`,
      [batchId],
    );
    return result.rows;
  }

  private async readImportItems(
    database: DatabaseExecutor,
    batchId: string,
  ): Promise<ImportItemRow[]> {
    const result = await database.query<ImportItemRow>(
      `SELECT i.id, i.section_id, i.source_row, i.sort_order, i.item_name,
              i.unit, i.raw_quantity, i.quantity_formula, i.sale_unit_price,
              i.cost_unit_price, i.remarks, s.name AS section_name,
              s.code AS section_code
         FROM catalog_import_items i
         JOIN catalog_import_sections s ON s.id = i.section_id
        WHERE s.batch_id = $1
        ORDER BY i.sort_order, i.id`,
      [batchId],
    );
    return result.rows;
  }
}

const batchSelect = `SELECT id, file_name, file_hash, status, validation_report,
                            created_by_user_id, published_version_id, created_at
                       FROM catalog_import_batches`;

function toWorkbookSection(row: ImportSectionRow): HalfPackageWorkbookSection {
  return {
    code: row.code,
    itemCount: row.item_count,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

function toWorkbookItem(row: ImportItemRow): HalfPackageWorkbookItem {
  return {
    costUnitPrice: row.cost_unit_price ?? "",
    itemName: row.item_name,
    quantityFormula: row.quantity_formula,
    rawQuantity: row.raw_quantity,
    remarks: row.remarks,
    saleUnitPrice: row.sale_unit_price ?? "",
    sectionName: row.section_name,
    sortOrder: row.sort_order,
    sourceRow: row.source_row,
    unit: row.unit,
  };
}

function stableItemBaseKey(item: ImportItemRow): string {
  const identity = JSON.stringify([
    item.section_code,
    item.item_name.normalize("NFKC").trim(),
    item.unit.normalize("NFKC").trim(),
  ]);
  return `${item.section_code}:${createHash("sha256").update(identity).digest("hex")}`;
}
