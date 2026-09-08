import { Inject, Injectable } from "@nestjs/common";
import type {
  HalfPackageSectionCode,
  ProjectDetail,
  SpaceType,
} from "@shanyu/contracts";
import { randomUUID } from "node:crypto";

import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from "../catalog/catalog.repository";
import {
  DatabaseClient,
  type DatabaseExecutor,
} from "../database/database.client";
import {
  PROJECTS_REPOSITORY,
  type ProjectsRepository,
} from "../project/projects.repository";
import type { QuantityRule } from "./half-package-calculator";
import {
  type ConfirmedQuotationAdjustment,
  type NewQuotationDraft,
  type NewQuotationExport,
  type QuotationDraft,
  type QuotationDecisionAction,
  type QuotationExport,
  type QuotationDraftLine,
  type QuotationDraftScope,
  type QuotationRepository,
  QuotationRevisionConflictError,
  type QuotationTemplate,
  type QuotationStatus,
} from "./quotation.repository";

interface RuleVersionRow {
  id: string;
}

interface VersionItemRow {
  id: string;
  standard_item_id: string;
}

interface TemplateVersionRow {
  id: string;
  version_number: number;
}

interface TemplateItemRow {
  cost_unit_price: string;
  id: string;
  item_name: string;
  remarks: string | null;
  sale_unit_price: string;
  section_code: HalfPackageSectionCode;
  section_name: string;
  sort_order: number;
  unit: string;
}

interface QuotationRow {
  adjustment_reason: string | null;
  adjustment_status: QuotationDraft["adjustmentStatus"];
  adjusted_total: string;
  cost_template_version_id: string;
  cost_template_version_number: number;
  created_by_user_id: string;
  direct_cost: string;
  discount_rate: string;
  expected_cost: string;
  gross_margin_rate: string | null;
  gross_profit: string;
  id: string;
  is_current: boolean;
  management_fee: string;
  management_rate: string;
  margin_benchmark_rate: string;
  parent_version_id: string | null;
  project_id: string;
  outer_frame_area: string;
  project_address: string;
  quantity_rule_version_id: string;
  revision: number;
  status: QuotationStatus;
  submitted_at: Date | null;
  submitted_by_user_id: string | null;
  decided_at: Date | null;
  decided_by_user_id: string | null;
  decision_action: QuotationDecisionAction | null;
  decision_reason: string | null;
  template_version_id: string;
  template_version_number: number;
  total: string;
  version_number: number;
  write_off: string;
}

interface ExportRow {
  content_type: string;
  content_sha256: string;
  created_at: Date;
  file_name: string;
  format: "PDF" | "XLSX";
  id: string;
  payload: Buffer;
  quotation_id: string;
}

interface ScopeRow {
  area: string | null;
  expected_cost: string;
  gross_margin_rate: string | null;
  gross_profit: string;
  height: string | null;
  id: string;
  name: string;
  perimeter: string | null;
  project_space_id: string | null;
  sort_order: number;
  space_type: SpaceType | null;
  subtotal: string;
}

interface LineRow {
  calculated_quantity: string | null;
  cost_amount: string | null;
  cost_unit_price: string;
  gross_margin_rate: string | null;
  gross_profit: string | null;
  id: string;
  item_name: string;
  manual_quantity: string | null;
  quantity_rule_kind: QuantityRule["kind"];
  quotation_space_id: string;
  referenced_line_id: string | null;
  remarks: string | null;
  sale_amount: string | null;
  sale_unit_price: string;
  section_code: HalfPackageSectionCode;
  section_name: string;
  selected: boolean;
  sort_order: number;
  unit: string;
  version_item_id: string;
}

@Injectable()
export class PgQuotationRepository implements QuotationRepository {
  constructor(
    private readonly database: DatabaseClient,
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepository: ProjectsRepository,
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
  ) {}

  findProject(projectId: string): Promise<ProjectDetail | null> {
    return this.projectsRepository.findById(projectId);
  }

  async findPublishedTemplate(): Promise<QuotationTemplate | null> {
    const catalog = await this.catalogRepository.getPublishedCatalog();
    if (!catalog) {
      return null;
    }
    const ruleResult = await this.database.query<RuleVersionRow>(
      `SELECT id
         FROM half_package_quantity_rule_versions
        ORDER BY version_number DESC
        LIMIT 1`,
    );
    const ruleVersionId = ruleResult.rows[0]?.id;
    if (!ruleVersionId) {
      return null;
    }
    const versionItemResult = await this.database.query<VersionItemRow>(
      `SELECT id, standard_item_id
         FROM half_package_version_items
        WHERE template_version_id = $1`,
      [catalog.id],
    );
    const versionItemIds = new Map(
      versionItemResult.rows.map(
        (item) => [item.standard_item_id, item.id] as const,
      ),
    );
    const sectionCodes = new Map(
      catalog.sections.map((section) => [section.name, section.code] as const),
    );
    return {
      id: catalog.id,
      items: catalog.items.map((item) => {
        const sectionCode = sectionCodes.get(item.sectionName);
        if (!sectionCode) {
          throw new Error("已发布主材库工程项缺少报价分区");
        }
        const versionItemId = versionItemIds.get(item.id);
        if (!versionItemId) {
          throw new Error("已发布主材库工程项缺少版本快照");
        }
        return {
          costUnitPrice: item.costUnitPrice,
          id: versionItemId,
          itemName: item.itemName,
          remarks: item.remarks,
          saleUnitPrice: item.saleUnitPrice,
          sectionCode,
          sectionName: item.sectionName,
          sortOrder: item.sortOrder,
          unit: item.unit,
        };
      }),
      ruleVersionId,
      versionNumber: catalog.versionNumber,
    };
  }

  async findTemplate(
    templateVersionId: string,
    ruleVersionId: string,
  ): Promise<QuotationTemplate | null> {
    const versionResult = await this.database.query<TemplateVersionRow>(
      `SELECT id, version_number
         FROM half_package_template_versions
        WHERE id = $1`,
      [templateVersionId],
    );
    const version = versionResult.rows[0];
    if (!version) {
      return null;
    }
    const itemResult = await this.database.query<TemplateItemRow>(
      `SELECT vi.id, vi.item_name, vi.remarks, vi.sort_order, vi.unit,
              hs.code AS section_code, hs.name AS section_name,
              pv.sale_unit_price, pv.cost_unit_price
         FROM half_package_version_items vi
         JOIN half_package_sections hs ON hs.id = vi.section_id
         JOIN half_package_item_price_versions pv
           ON pv.version_item_id = vi.id
        WHERE vi.template_version_id = $1
        ORDER BY vi.sort_order, vi.id`,
      [templateVersionId],
    );
    return {
      id: version.id,
      items: itemResult.rows.map((item) => ({
        costUnitPrice: item.cost_unit_price,
        id: item.id,
        itemName: item.item_name,
        remarks: item.remarks,
        saleUnitPrice: item.sale_unit_price,
        sectionCode: item.section_code,
        sectionName: item.section_name,
        sortOrder: item.sort_order,
        unit: item.unit,
      })),
      ruleVersionId,
      versionNumber: version.version_number,
    };
  }

  async findDraft(projectId: string): Promise<QuotationDraft | null> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect}
        WHERE q.project_id = $1 AND q.status = 'DRAFT' AND q.is_current`,
      [projectId],
    );
    return result.rows[0]
      ? this.hydrateDraft(this.database, result.rows[0])
      : null;
  }

  async findLatest(projectId: string): Promise<QuotationDraft | null> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect}
        WHERE q.project_id = $1 AND q.is_current
        ORDER BY q.version_number DESC
        LIMIT 1`,
      [projectId],
    );
    return result.rows[0]
      ? this.hydrateDraft(this.database, result.rows[0])
      : null;
  }

  async findById(quotationId: string): Promise<QuotationDraft | null> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect} WHERE q.id = $1`,
      [quotationId],
    );
    return result.rows[0]
      ? this.hydrateDraft(this.database, result.rows[0])
      : null;
  }

  async listByProject(projectId: string): Promise<readonly QuotationDraft[]> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect}
        WHERE q.project_id = $1
        ORDER BY q.version_number DESC`,
      [projectId],
    );
    return Promise.all(
      result.rows.map((row) => this.hydrateDraft(this.database, row)),
    );
  }

  async listQuoted(): Promise<readonly QuotationDraft[]> {
    const result = await this.database.query<QuotationRow>(
      `${quotationSelect}
        WHERE q.status = 'QUOTED'
          AND q.adjustment_status = 'PENDING_APPROVAL'
          AND q.is_current
        ORDER BY q.submitted_at DESC, q.id`,
    );
    return Promise.all(
      result.rows.map((row) => this.hydrateDraft(this.database, row)),
    );
  }

  async createDraft(input: NewQuotationDraft): Promise<QuotationDraft> {
    await this.database.transaction(async (database) => {
      await database.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [
        input.projectId,
      ]);
      const existing = await database.query(
        `SELECT id
           FROM half_package_quotations
          WHERE project_id = $1 AND is_current`,
        [input.projectId],
      );
      if (existing.rowCount !== 0) {
        return;
      }
      const inserted = await database.query(
        `INSERT INTO half_package_quotations
           (id, project_id, version_number, status, template_version_id,
            cost_template_version_id, quantity_rule_version_id, outer_frame_area,
            management_rate, direct_cost, expected_cost, gross_profit,
            gross_margin_rate, management_fee, total, adjusted_total,
            discount_rate, write_off, revision, created_by_user_id,
            project_address, is_current)
         VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18, $19, $20, true)
         ON CONFLICT ON CONSTRAINT half_package_quotations_version
         DO NOTHING
         RETURNING id`,
        [
          input.id,
          input.projectId,
          input.versionNumber,
          input.templateVersionId,
          input.costTemplateVersionId,
          input.ruleVersionId,
          input.outerFrameArea,
          input.managementRate,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
          input.adjustedTotal,
          input.discountRate,
          input.writeOff,
          input.revision,
          input.createdByUserId,
          input.projectAddress,
        ],
      );
      if (inserted.rowCount !== 1) {
        return;
      }
      if (input.parentVersionId) {
        await database.query(
          `UPDATE half_package_quotations
              SET parent_version_id = $2
            WHERE id = $1`,
          [input.id, input.parentVersionId],
        );
      }
      for (const scope of input.scopes) {
        await insertScope(database, input.id, scope);
      }
    });
    const created = await this.findDraft(input.projectId);
    if (!created) {
      throw new Error("创建半包报价草稿后无法读取结果");
    }
    return created;
  }

  async addDraftScopes(
    input: QuotationDraft,
    scopes: readonly QuotationDraftScope[],
    expectedRevision: number,
  ): Promise<QuotationDraft> {
    await this.database.transaction(async (database) => {
      const updated = await database.query(
        `UPDATE half_package_quotations
            SET direct_cost = $3, expected_cost = $4, gross_profit = $5,
                gross_margin_rate = $6, management_fee = $7, total = $8,
                adjusted_total = $9, revision = $10,
                updated_at = current_timestamp
          WHERE id = $1 AND project_id = $2 AND status = 'DRAFT'
            AND is_current AND revision = $11`,
        [
          input.id,
          input.projectId,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
          input.adjustedTotal,
          input.revision,
          expectedRevision,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new QuotationRevisionConflictError();
      }
      for (const scope of scopes) {
        await insertScope(database, input.id, scope);
      }
    });
    const saved = await this.findDraft(input.projectId);
    if (!saved) {
      throw new Error("补齐半包报价空间后无法读取结果");
    }
    return saved;
  }

  async saveDraft(
    input: QuotationDraft,
    expectedRevision: number,
  ): Promise<QuotationDraft> {
    await this.database.transaction(async (database) => {
      const updated = await database.query(
        `UPDATE half_package_quotations
            SET direct_cost = $3, expected_cost = $4, gross_profit = $5,
                gross_margin_rate = $6, management_fee = $7, total = $8,
                adjusted_total = $9, revision = $10,
                updated_at = current_timestamp
          WHERE id = $1 AND project_id = $2 AND status = 'DRAFT'
            AND is_current AND revision = $11`,
        [
          input.id,
          input.projectId,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
          input.adjustedTotal,
          input.revision,
          expectedRevision,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new QuotationRevisionConflictError();
      }
      for (const scope of input.scopes) {
        const scopeUpdate = await database.query(
          `UPDATE half_package_quotation_spaces
              SET subtotal = $3, expected_cost = $4, gross_profit = $5,
                  gross_margin_rate = $6
            WHERE id = $1 AND quotation_id = $2`,
          [
            scope.id,
            input.id,
            scope.subtotal,
            scope.expectedCost,
            scope.grossProfit,
            scope.grossMarginRate,
          ],
        );
        if (scopeUpdate.rowCount !== 1) {
          throw new Error("报价范围不存在");
        }
        for (const line of scope.lines) {
          const lineUpdate = await database.query(
            `UPDATE half_package_quotation_lines
                SET selected = $3, manual_quantity = $4,
                    calculated_quantity = $5, sale_amount = $6,
                    cost_amount = $7, gross_profit = $8,
                    gross_margin_rate = $9
              WHERE id = $1 AND quotation_space_id = $2`,
            [
              line.id,
              scope.id,
              line.selected,
              line.manualQuantity,
              line.calculatedQuantity,
              line.amount,
              line.costAmount,
              line.grossProfit,
              line.grossMarginRate,
            ],
          );
          if (lineUpdate.rowCount !== 1) {
            throw new Error("报价工程项不存在");
          }
        }
      }
    });
    const saved = await this.findDraft(input.projectId);
    if (!saved) {
      throw new Error("保存半包报价草稿后无法读取结果");
    }
    return saved;
  }

  async saveAdjustment(
    quotationId: string,
    discountRate: string,
    writeOff: string,
    adjustedTotal: string,
    grossProfit: string,
    grossMarginRate: string | null,
    actorUserId: string,
    reason: string | null,
    expectedRevision: number,
  ): Promise<QuotationDraft> {
    const updated = await this.database.query(
      `UPDATE half_package_quotations
          SET discount_rate = $2, write_off = $3, adjusted_total = $4,
              gross_profit = $5, gross_margin_rate = $6,
              adjustment_status = 'PENDING_APPROVAL',
              adjustment_reason = $7,
              adjustment_submitted_by_user_id = $8,
              adjustment_submitted_at = current_timestamp,
              revision = revision + 1, updated_at = current_timestamp
        WHERE id = $1 AND status = 'QUOTED' AND is_current
          AND adjustment_status = 'AWAITING_SUBMISSION'
          AND revision = $9`,
      [
        quotationId,
        discountRate,
        writeOff,
        adjustedTotal,
        grossProfit,
        grossMarginRate,
        reason,
        actorUserId,
        expectedRevision,
      ],
    );
    if (updated.rowCount !== 1) throw new QuotationRevisionConflictError();
    const saved = await this.findById(quotationId);
    if (!saved) throw new Error("保存折扣与抹零后无法读取报价");
    return saved;
  }

  async updateMarginBenchmarkRate(
    quotationId: string,
    marginBenchmarkRate: string,
  ): Promise<QuotationDraft> {
    const updated = await this.database.query(
      `UPDATE half_package_quotations
          SET margin_benchmark_rate = $2, updated_at = current_timestamp
        WHERE id = $1`,
      [quotationId, marginBenchmarkRate],
    );
    if (updated.rowCount !== 1) {
      throw new QuotationRevisionConflictError();
    }
    const saved = await this.findById(quotationId);
    if (!saved) throw new Error("保存基准毛利率后无法读取报价");
    return saved;
  }

  async submitDraft(
    quotationId: string,
    actorUserId: string,
    expectedRevision: number,
  ): Promise<QuotationDraft> {
    await this.database.transaction(async (database) => {
      const updated = await database.query(
        `UPDATE half_package_quotations
            SET status = 'QUOTED', submitted_by_user_id = $2,
                submitted_at = current_timestamp, updated_at = current_timestamp
          WHERE id = $1 AND status = 'DRAFT' AND is_current
            AND revision = $3`,
        [quotationId, actorUserId, expectedRevision],
      );
      if (updated.rowCount !== 1) {
        throw new QuotationRevisionConflictError();
      }
      await insertDecision(database, quotationId, actorUserId, "QUOTED", null);
    });
    const submitted = await this.findById(quotationId);
    if (!submitted) {
      throw new Error("确认生成半包报价单后无法读取结果");
    }
    return submitted;
  }

  async decide(
    quotationId: string,
    actorUserId: string,
    action: QuotationDecisionAction,
    reason: string | null,
    adjustment?: ConfirmedQuotationAdjustment,
  ): Promise<QuotationDraft> {
    const resultId = await this.database.transaction(async (database) => {
      const target = await database.query<QuotationRow>(
        `${quotationSelect}
          WHERE q.id = $1 AND q.is_current
            AND (
              (q.status = 'QUOTED' AND q.adjustment_status = 'PENDING_APPROVAL')
              OR (q.status = 'QUOTED' AND $2 = 'APPROVED' AND $3::boolean)
              OR (q.status = 'APPROVED' AND $2 = 'RETURNED')
            )
          FOR UPDATE OF q`,
        [quotationId, action, Boolean(adjustment)],
      );
      const row = target.rows[0];
      if (!row) throw new QuotationRevisionConflictError();
      let source = await this.hydrateDraft(database, row);
      if (adjustment) {
        if (
          source.status !== "QUOTED" ||
          source.adjustmentStatus !== "AWAITING_SUBMISSION" ||
          source.revision !== adjustment.expectedRevision
        ) {
          throw new QuotationRevisionConflictError();
        }
        const adjusted = await database.query(
          `UPDATE half_package_quotations
              SET discount_rate = $2, write_off = $3, adjusted_total = $4,
                  gross_profit = $5, gross_margin_rate = $6,
                  adjustment_status = 'CONFIRMED', adjustment_reason = $7,
                  adjustment_submitted_by_user_id = $8,
                  adjustment_submitted_at = current_timestamp,
                  revision = revision + 1, updated_at = current_timestamp
            WHERE id = $1 AND is_current AND status = 'QUOTED'
              AND adjustment_status = 'AWAITING_SUBMISSION'
              AND revision = $9`,
          [
            source.id,
            adjustment.discountRate,
            adjustment.writeOff,
            adjustment.adjustedTotal,
            adjustment.grossProfit,
            adjustment.grossMarginRate,
            adjustment.reason,
            actorUserId,
            adjustment.expectedRevision,
          ],
        );
        if (adjusted.rowCount !== 1) throw new QuotationRevisionConflictError();
        source = {
          ...source,
          adjustedTotal: adjustment.adjustedTotal,
          adjustmentReason: adjustment.reason,
          adjustmentStatus: "CONFIRMED",
          discountRate: adjustment.discountRate,
          grossMarginRate: adjustment.grossMarginRate,
          grossProfit: adjustment.grossProfit,
          revision: source.revision + 1,
          writeOff: adjustment.writeOff,
        };
      }
      const nextVersion = source.versionNumber + 1;
      const cloned = cloneAsVersion(source, actorUserId, nextVersion, true);
      await database.query(
        `UPDATE half_package_quotations
            SET is_current = false, updated_at = current_timestamp
          WHERE id = $1 AND is_current`,
        [source.id],
      );
      await insertDraft(database, cloned);
      const status = action === "RETURNED" ? "RETURNED" : "APPROVED";
      const updated = await database.query(
        `UPDATE half_package_quotations
            SET status = $2, submitted_by_user_id = $3,
                submitted_at = coalesce($4, current_timestamp),
                decided_by_user_id = $3, decided_at = current_timestamp,
                decision_action = $5, decision_reason = $6,
                adjustment_status = $7,
                updated_at = current_timestamp
          WHERE id = $1 AND status = 'DRAFT' AND is_current`,
        [
          cloned.id,
          status,
          actorUserId,
          source.submittedAt,
          action,
          reason,
          action === "RETURNED" ? "AWAITING_SUBMISSION" : "CONFIRMED",
        ],
      );
      if (updated.rowCount !== 1) throw new QuotationRevisionConflictError();
      await insertDecision(database, cloned.id, actorUserId, action, reason);
      return cloned.id;
    });
    const decided = await this.findById(resultId);
    if (!decided) {
      throw new Error("审批半包报价后无法读取结果");
    }
    return decided;
  }

  async continueEditing(
    source: QuotationDraft,
    actorUserId: string,
  ): Promise<QuotationDraft> {
    const draftId = await this.database.transaction(async (database) => {
      const locked = await database.query<QuotationRow>(
        `${quotationSelect}
          WHERE q.id = $1 AND q.project_id = $2 AND q.is_current
            AND q.status IN ('QUOTED', 'RETURNED')
          FOR UPDATE OF q`,
        [source.id, source.projectId],
      );
      const row = locked.rows[0];
      if (!row) throw new QuotationRevisionConflictError();
      const lockedSource = await this.hydrateDraft(database, row);
      const cloned = cloneAsVersion(
        lockedSource,
        actorUserId,
        lockedSource.versionNumber + 1,
        lockedSource.status === "RETURNED",
      );
      await database.query(
        `UPDATE half_package_quotations
            SET is_current = false, updated_at = current_timestamp
          WHERE id = $1 AND is_current`,
        [lockedSource.id],
      );
      await insertDraft(database, cloned);
      return cloned.id;
    });
    const draft = await this.findById(draftId);
    if (!draft) throw new Error("继续编辑后无法读取新草稿");
    return draft;
  }

  async createExport(input: NewQuotationExport): Promise<QuotationExport> {
    await this.database.query(
      `INSERT INTO half_package_exports
         (id, quotation_id, format, file_name, content_type,
          content_sha256, payload, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.quotationId,
        input.format,
        input.fileName,
        input.contentType,
        input.sha256,
        input.payload,
        input.createdByUserId,
        input.createdAt,
      ],
    );
    return input;
  }

  async findExport(exportId: string): Promise<QuotationExport | null> {
    const result = await this.database.query<ExportRow>(
      `SELECT id, quotation_id, format, file_name, content_type,
              content_sha256, payload, created_at
         FROM half_package_exports
        WHERE id = $1`,
      [exportId],
    );
    const row = result.rows[0];
    return row
      ? {
          contentType: row.content_type,
          createdAt: row.created_at,
          fileName: row.file_name,
          format: row.format,
          id: row.id,
          payload: row.payload,
          quotationId: row.quotation_id,
          sha256: row.content_sha256,
        }
      : null;
  }

  private async hydrateDraft(
    database: DatabaseExecutor,
    row: QuotationRow,
  ): Promise<QuotationDraft> {
    const scopeResult = await database.query<ScopeRow>(
      `SELECT id, project_space_id, name, space_type, area, perimeter,
              height, subtotal, expected_cost, gross_profit,
              gross_margin_rate, sort_order
         FROM half_package_quotation_spaces
        WHERE quotation_id = $1
        ORDER BY sort_order, id`,
      [row.id],
    );
    const lineResult = await database.query<LineRow>(
      `SELECT l.id, l.quotation_space_id, l.version_item_id,
              l.section_code, l.section_name, l.item_name, l.unit,
              l.remarks, l.sort_order, l.selected, l.quantity_rule_kind,
              l.referenced_line_id, l.manual_quantity,
              l.calculated_quantity, l.sale_unit_price, l.sale_amount,
              l.cost_unit_price, l.cost_amount, l.gross_profit,
              l.gross_margin_rate
         FROM half_package_quotation_lines l
         JOIN half_package_quotation_spaces qs
           ON qs.id = l.quotation_space_id
        WHERE qs.quotation_id = $1
        ORDER BY qs.sort_order, l.sort_order, l.id`,
      [row.id],
    );
    return {
      adjustmentReason: row.adjustment_reason,
      adjustmentStatus: row.adjustment_status,
      adjustedTotal: row.adjusted_total,
      costTemplateVersionId: row.cost_template_version_id,
      costTemplateVersionNumber: row.cost_template_version_number,
      createdByUserId: row.created_by_user_id,
      directCost: row.direct_cost,
      discountRate: row.discount_rate,
      expectedCost: row.expected_cost,
      grossMarginRate: row.gross_margin_rate,
      grossProfit: row.gross_profit,
      id: row.id,
      isCurrent: row.is_current,
      managementFee: row.management_fee,
      managementRate: row.management_rate,
      marginBenchmarkRate: row.margin_benchmark_rate,
      parentVersionId: row.parent_version_id,
      projectId: row.project_id,
      outerFrameArea: row.outer_frame_area,
      projectAddress: row.project_address,
      revision: row.revision,
      ruleVersionId: row.quantity_rule_version_id,
      scopes: scopeResult.rows.map((scope) => ({
        area: scope.area,
        height: scope.height,
        id: scope.id,
        expectedCost: scope.expected_cost,
        grossMarginRate: scope.gross_margin_rate,
        grossProfit: scope.gross_profit,
        lines: lineResult.rows
          .filter((line) => line.quotation_space_id === scope.id)
          .map(toDraftLine),
        name: scope.name,
        perimeter: scope.perimeter,
        projectSpaceId: scope.project_space_id,
        sortOrder: scope.sort_order,
        spaceType: scope.space_type,
        subtotal: scope.subtotal,
      })),
      status: row.status,
      submittedAt: row.submitted_at,
      submittedByUserId: row.submitted_by_user_id,
      decidedAt: row.decided_at,
      decidedByUserId: row.decided_by_user_id,
      decisionAction: row.decision_action,
      decisionReason: row.decision_reason,
      templateVersionId: row.template_version_id,
      templateVersionNumber: row.template_version_number,
      total: row.total,
      versionNumber: row.version_number,
      writeOff: row.write_off,
    };
  }
}

async function insertDraft(
  database: DatabaseExecutor,
  input: QuotationDraft,
): Promise<void> {
  await database.query(
    `INSERT INTO half_package_quotations
       (id, project_id, version_number, status, template_version_id,
        cost_template_version_id, quantity_rule_version_id, outer_frame_area,
        management_rate, direct_cost, expected_cost, gross_profit,
        gross_margin_rate, management_fee, total, adjusted_total,
        discount_rate, write_off, revision, created_by_user_id,
        project_address, is_current, parent_version_id, adjustment_status,
        adjustment_reason, margin_benchmark_rate)
     VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18, $19, $20, true, $21, $22,
             $23, $24)`,
    [
      input.id,
      input.projectId,
      input.versionNumber,
      input.templateVersionId,
      input.costTemplateVersionId,
      input.ruleVersionId,
      input.outerFrameArea,
      input.managementRate,
      input.directCost,
      input.expectedCost,
      input.grossProfit,
      input.grossMarginRate,
      input.managementFee,
      input.total,
      input.adjustedTotal,
      input.discountRate,
      input.writeOff,
      input.revision,
      input.createdByUserId,
      input.projectAddress,
      input.parentVersionId,
      input.adjustmentStatus,
      input.adjustmentReason,
      input.marginBenchmarkRate,
    ],
  );
  for (const scope of input.scopes) {
    await insertScope(database, input.id, scope);
  }
}

async function insertScope(
  database: DatabaseExecutor,
  quotationId: string,
  scope: QuotationDraftScope,
): Promise<void> {
  await database.query(
    `INSERT INTO half_package_quotation_spaces
       (id, quotation_id, project_space_id, name, space_type, area,
        perimeter, height, subtotal, expected_cost, gross_profit,
        gross_margin_rate, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      scope.id,
      quotationId,
      scope.projectSpaceId,
      scope.name,
      scope.spaceType,
      scope.area,
      scope.perimeter,
      scope.height,
      scope.subtotal,
      scope.expectedCost,
      scope.grossProfit,
      scope.grossMarginRate,
      scope.sortOrder,
    ],
  );
  const orderedLines = [...scope.lines].sort((left, right) =>
    left.quantityRule.kind === "LINE_REFERENCE" &&
    right.quantityRule.kind !== "LINE_REFERENCE"
      ? 1
      : left.quantityRule.kind !== "LINE_REFERENCE" &&
          right.quantityRule.kind === "LINE_REFERENCE"
        ? -1
        : left.sortOrder - right.sortOrder,
  );
  for (const line of orderedLines) {
    await insertLine(database, scope.id, line);
  }
}

async function insertLine(
  database: DatabaseExecutor,
  scopeId: string,
  line: QuotationDraftLine,
): Promise<void> {
  await database.query(
    `INSERT INTO half_package_quotation_lines
       (id, quotation_space_id, version_item_id, section_code, section_name,
        item_name, unit, remarks, sort_order, selected, quantity_rule_kind,
        referenced_line_id, manual_quantity, calculated_quantity,
        sale_unit_price, sale_amount, cost_unit_price, cost_amount,
        gross_profit, gross_margin_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      line.id,
      scopeId,
      line.versionItemId,
      line.sectionCode,
      line.sectionName,
      line.itemName,
      line.unit,
      line.remarks,
      line.sortOrder,
      line.selected,
      line.quantityRule.kind,
      line.quantityRule.kind === "LINE_REFERENCE"
        ? line.quantityRule.referencedLineId
        : null,
      line.manualQuantity,
      line.calculatedQuantity,
      line.saleUnitPrice,
      line.amount,
      line.costUnitPrice,
      line.costAmount,
      line.grossProfit,
      line.grossMarginRate,
    ],
  );
}

function toDraftLine(row: LineRow): QuotationDraftLine {
  return {
    amount: row.sale_amount,
    calculatedQuantity: row.calculated_quantity,
    costAmount: row.cost_amount,
    costUnitPrice: row.cost_unit_price,
    grossMarginRate: row.gross_margin_rate,
    grossProfit: row.gross_profit,
    id: row.id,
    itemName: row.item_name,
    manualQuantity: row.manual_quantity,
    quantityRule:
      row.quantity_rule_kind === "LINE_REFERENCE"
        ? {
            kind: "LINE_REFERENCE",
            referencedLineId: requiredReference(row),
          }
        : { kind: row.quantity_rule_kind },
    remarks: row.remarks,
    saleUnitPrice: row.sale_unit_price,
    sectionCode: row.section_code,
    sectionName: row.section_name,
    selected: row.selected,
    sortOrder: row.sort_order,
    unit: row.unit,
    versionItemId: row.version_item_id,
  };
}

function requiredReference(row: LineRow): string {
  if (!row.referenced_line_id) {
    throw new Error("引用数量规则缺少目标工程项");
  }
  return row.referenced_line_id;
}

function formatRate(numerator: number, denominator: number): string | null {
  return denominator === 0 ? null : (numerator / denominator).toFixed(4);
}

async function insertDecision(
  database: DatabaseExecutor,
  quotationId: string,
  actorUserId: string,
  action: "QUOTED" | QuotationDecisionAction,
  reason: string | null,
): Promise<void> {
  await database.query(
    `INSERT INTO half_package_approval_decisions
       (id, quotation_id, action, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), quotationId, action, actorUserId, reason],
  );
}

function cloneAsVersion(
  source: QuotationDraft,
  actorUserId: string,
  versionNumber: number,
  preserveAdjustment = false,
): QuotationDraft {
  const lineIds = new Map<string, string>();
  for (const line of source.scopes.flatMap((scope) => scope.lines)) {
    lineIds.set(line.id, randomUUID());
  }
  return {
    ...source,
    adjustedTotal: preserveAdjustment ? source.adjustedTotal : source.total,
    adjustmentReason: preserveAdjustment ? source.adjustmentReason : null,
    adjustmentStatus: preserveAdjustment
      ? source.adjustmentStatus
      : "AWAITING_SUBMISSION",
    createdByUserId: actorUserId,
    decidedAt: null,
    decidedByUserId: null,
    decisionAction: null,
    decisionReason: null,
    id: randomUUID(),
    isCurrent: true,
    parentVersionId: source.id,
    revision: 0,
    scopes: source.scopes.map((scope) => ({
      ...scope,
      id: randomUUID(),
      lines: scope.lines.map((line) => ({
        ...line,
        id: lineIds.get(line.id) ?? randomUUID(),
        quantityRule:
          line.quantityRule.kind === "LINE_REFERENCE"
            ? {
                kind: "LINE_REFERENCE" as const,
                referencedLineId:
                  lineIds.get(line.quantityRule.referencedLineId) ??
                  line.quantityRule.referencedLineId,
              }
            : line.quantityRule,
      })),
    })),
    status: "DRAFT",
    submittedAt: null,
    submittedByUserId: null,
    versionNumber,
    discountRate: preserveAdjustment ? source.discountRate : "1.0000",
    grossMarginRate: preserveAdjustment
      ? source.grossMarginRate
      : source.total === "0.0000"
        ? null
        : formatRate(
            Number(source.total) - Number(source.expectedCost),
            Number(source.total),
          ),
    grossProfit: preserveAdjustment
      ? source.grossProfit
      : (Number(source.total) - Number(source.expectedCost)).toFixed(4),
    writeOff: preserveAdjustment ? source.writeOff : "0.0000",
  };
}

const quotationSelect = `SELECT q.id, q.project_id, q.project_address,
                                 q.adjustment_status, q.adjustment_reason,
                                 q.version_number, q.status,
                                 q.parent_version_id, q.submitted_by_user_id,
                                 q.submitted_at, q.decided_by_user_id,
                                 q.decided_at, q.decision_action,
                                 q.decision_reason, q.template_version_id,
                                 tv.version_number AS template_version_number,
                                 q.cost_template_version_id,
                                 ctv.version_number AS cost_template_version_number,
                                 q.quantity_rule_version_id, q.outer_frame_area,
                                 q.management_rate, q.direct_cost, q.expected_cost,
                                 q.margin_benchmark_rate,
                                 q.gross_profit, q.gross_margin_rate,
                                 q.management_fee, q.total, q.adjusted_total,
                                 q.discount_rate, q.write_off, q.is_current,
                                 q.revision,
                                 q.created_by_user_id
                            FROM half_package_quotations q
                            JOIN half_package_template_versions tv
                              ON tv.id = q.template_version_id
                            JOIN half_package_template_versions ctv
                              ON ctv.id = q.cost_template_version_id`;
