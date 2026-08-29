import { Inject, Injectable } from "@nestjs/common";
import type {
  HalfPackageSectionCode,
  ProjectDetail,
  SpaceType,
} from "@shanyu/contracts";

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
  type NewQuotationDraft,
  type QuotationDraft,
  type QuotationDraftLine,
  type QuotationDraftScope,
  type QuotationRepository,
  QuotationRevisionConflictError,
  type QuotationTemplate,
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
  building_area: string;
  cost_template_version_id: string;
  cost_template_version_number: number;
  created_by_user_id: string;
  direct_cost: string;
  expected_cost: string;
  gross_margin_rate: string | null;
  gross_profit: string;
  id: string;
  management_fee: string;
  management_rate: string;
  project_id: string;
  project_name: string;
  quantity_rule_version_id: string;
  revision: number;
  status: "DRAFT";
  template_version_id: string;
  template_version_number: number;
  total: string;
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
        WHERE q.project_id = $1 AND q.status = 'DRAFT'`,
      [projectId],
    );
    return result.rows[0]
      ? this.hydrateDraft(this.database, result.rows[0])
      : null;
  }

  async createDraft(input: NewQuotationDraft): Promise<QuotationDraft> {
    await this.database.transaction(async (database) => {
      await database.query(
        `INSERT INTO half_package_quotations
           (id, project_id, version_number, status, template_version_id,
            cost_template_version_id, quantity_rule_version_id, building_area,
            management_rate, direct_cost, expected_cost, gross_profit,
            gross_margin_rate, management_fee, total, revision, created_by_user_id)
         VALUES ($1, $2, 1, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15)`,
        [
          input.id,
          input.projectId,
          input.templateVersionId,
          input.costTemplateVersionId,
          input.ruleVersionId,
          input.buildingArea,
          input.managementRate,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
          input.revision,
          input.createdByUserId,
        ],
      );
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
                revision = $9, updated_at = current_timestamp
          WHERE id = $1 AND project_id = $2 AND status = 'DRAFT'
            AND revision = $10`,
        [
          input.id,
          input.projectId,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
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
                revision = $9, updated_at = current_timestamp
          WHERE id = $1 AND project_id = $2 AND status = 'DRAFT'
            AND revision = $10`,
        [
          input.id,
          input.projectId,
          input.directCost,
          input.expectedCost,
          input.grossProfit,
          input.grossMarginRate,
          input.managementFee,
          input.total,
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
      buildingArea: row.building_area,
      costTemplateVersionId: row.cost_template_version_id,
      costTemplateVersionNumber: row.cost_template_version_number,
      createdByUserId: row.created_by_user_id,
      directCost: row.direct_cost,
      expectedCost: row.expected_cost,
      grossMarginRate: row.gross_margin_rate,
      grossProfit: row.gross_profit,
      id: row.id,
      managementFee: row.management_fee,
      managementRate: row.management_rate,
      projectId: row.project_id,
      projectName: row.project_name,
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
      templateVersionId: row.template_version_id,
      templateVersionNumber: row.template_version_number,
      total: row.total,
    };
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

const quotationSelect = `SELECT q.id, q.project_id, p.name AS project_name,
                                 q.status, q.template_version_id,
                                 tv.version_number AS template_version_number,
                                 q.cost_template_version_id,
                                 ctv.version_number AS cost_template_version_number,
                                 q.quantity_rule_version_id, q.building_area,
                                 q.management_rate, q.direct_cost, q.expected_cost,
                                 q.gross_profit, q.gross_margin_rate,
                                 q.management_fee, q.total, q.revision,
                                 q.created_by_user_id
                            FROM half_package_quotations q
                            JOIN projects p ON p.id = q.project_id
                            JOIN half_package_template_versions tv
                              ON tv.id = q.template_version_id
                            JOIN half_package_template_versions ctv
                              ON ctv.id = q.cost_template_version_id`;
