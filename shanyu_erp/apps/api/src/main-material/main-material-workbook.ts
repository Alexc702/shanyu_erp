import type {
  MainMaterialCategoryCode,
  MainMaterialImportMode,
  MainMaterialImportValidation,
} from "@shanyu/contracts";
import ExcelJS from "exceljs";

import type {
  MainMaterialDelta,
  NormalizedMainMaterialItem,
} from "./main-material.repository";

const categoryNames: Readonly<Record<MainMaterialCategoryCode, string>> = {
  BATHROOM: "卫浴",
  CEILING: "集成吊顶",
  CUSTOM: "定制类",
  FLOOR: "木地板",
  GLASS_DOOR: "房门|门套 - 玻璃门",
  SEAM: "美缝",
  SHOWER: "淋浴房",
  STONE: "石材|岩板",
  SWITCH: "开关面板",
  TILE: "瓷砖",
};

const fullHeaders = {
  attributes: [
    ["类型", "type"],
    ["木种", "woodSpecies"],
    ["基材", "substrate"],
    ["规格/面皮厚度", "thickness"],
    ["等级", "grade"],
    ["锁扣", "lockType"],
    ["包装", "packaging"],
    ["面板尺寸", "panelSize"],
    ["照明功率", "lightingPower"],
    ["产品图引用", "imageReference"],
  ] as const,
  brand: "品牌",
  categoryCode: "分类代码",
  categoryName: "分类",
  colors: "可选颜色",
  costPrice: "成本价（敏感）",
  itemName: "品名/项目",
  materialId: "material_id",
  missingFields: "缺失字段",
  model: "型号",
  priceDerivation: "价格换算说明",
  recordVersion: "record_version",
  remarks: "备注",
  salePrice: "销售价",
  series: "系列/工艺",
  sourceFile: "来源文件",
  sourceRow: "来源行/型号",
  sourceSheet: "来源工作表/页",
  spec: "规格",
  status: "数据状态",
  unit: "单位",
} as const;

export interface ParsedMainMaterialWorkbook {
  readonly mode: MainMaterialImportMode;
  readonly payload: readonly NormalizedMainMaterialItem[] | readonly MainMaterialDelta[];
  readonly validation: MainMaterialImportValidation;
}

export async function parseMainMaterialWorkbook(
  buffer: Buffer,
  mode: MainMaterialImportMode,
): Promise<ParsedMainMaterialWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return mode === "FULL" ? parseFull(workbook) : parseDelta(workbook);
}

function parseFull(workbook: ExcelJS.Workbook): ParsedMainMaterialWorkbook {
  const sheet = workbook.getWorksheet("主材库");
  if (!sheet) return failed("Excel 缺少“主材库”工作表", "FULL");
  const columns = headerMap(sheet.getRow(4));
  const requiredHeaders = Object.values(fullHeaders).flatMap((value) =>
    typeof value === "string" ? [value] : value.map(([header]) => header),
  );
  const missingHeaders = requiredHeaders.filter((header) => !columns.has(header));
  if (missingHeaders.length) {
    return failed(`主材库缺少字段：${missingHeaders.join("、")}`, "FULL");
  }

  const items: NormalizedMainMaterialItem[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const materialId = cell(row, columns, fullHeaders.materialId);
    if (!materialId) continue;
    const categoryCode = cell(row, columns, fullHeaders.categoryCode);
    const status = cell(row, columns, fullHeaders.status);
    const itemName = cell(row, columns, fullHeaders.itemName);
    const model = cell(row, columns, fullHeaders.model);
    const unit = cell(row, columns, fullHeaders.unit);
    const salePrice = money(row, columns, fullHeaders.salePrice);
    const costPrice = money(row, columns, fullHeaders.costPrice);
    if (ids.has(materialId)) blockers.push(`第 ${rowNumber} 行 material_id 重复`);
    ids.add(materialId);
    if (!isCategory(categoryCode)) blockers.push(`第 ${rowNumber} 行分类代码无效`);
    if (!isStatus(status)) blockers.push(`第 ${rowNumber} 行数据状态无效`);
    const recordVersion = positiveInteger(cell(row, columns, fullHeaders.recordVersion));
    if (!recordVersion) blockers.push(`第 ${rowNumber} 行记录版本无效`);
    if (!isCategory(categoryCode) || !isStatus(status)) continue;
    const brand = cell(row, columns, fullHeaders.brand);
    const spec = cell(row, columns, fullHeaders.spec);
    const requiredMissing = requiredMissingFields({
      brand, categoryCode, costPrice, itemName, model, salePrice, spec, unit,
    });
    const effectiveStatus = status === "ACTIVE" && requiredMissing.length
      ? "PENDING_DATA"
      : status;
    if (status === "ACTIVE" && effectiveStatus === "PENDING_DATA") {
      warnings.push(`第 ${rowNumber} 行缺少${requiredMissing.join("、")}，已转为待补资料`);
    } else if (status === "PENDING_DATA") {
      warnings.push(`第 ${rowNumber} 行为待补资料，不进入选型`);
    }
    items.push({
      attributes: Object.fromEntries(
        fullHeaders.attributes.map(([header, key]) => [key, cell(row, columns, header)]),
      ),
      brand,
      categoryCode,
      categoryName: cell(row, columns, fullHeaders.categoryName) || categoryNames[categoryCode],
      colors: list(cell(row, columns, fullHeaders.colors)),
      costPrice,
      itemName,
      materialId,
      missingFields: mergeMissingFields(
        cell(row, columns, fullHeaders.missingFields),
        requiredMissing,
      ),
      model,
      priceDerivation: cell(row, columns, fullHeaders.priceDerivation),
      recordVersion: recordVersion || 1,
      remarks: cell(row, columns, fullHeaders.remarks),
      salePrice,
      series: cell(row, columns, fullHeaders.series),
      sourceFile: cell(row, columns, fullHeaders.sourceFile),
      sourceRow: cell(row, columns, fullHeaders.sourceRow),
      sourceSheet: cell(row, columns, fullHeaders.sourceSheet),
      spec,
      status: effectiveStatus,
      unit,
    });
  }
  if (!items.length) blockers.push("主材库没有可导入记录");
  return result("FULL", items, blockers, warnings);
}

function parseDelta(workbook: ExcelJS.Workbook): ParsedMainMaterialWorkbook {
  const sheet = workbook.getWorksheet("Delta导入模板");
  if (!sheet) return failed("Excel 缺少“Delta导入模板”工作表", "DELTA");
  const columns = headerMap(sheet.getRow(7));
  const required = [
    "operation",
    "material_id",
    "expected_record_version",
    "change_reason",
  ];
  const missingHeaders = required.filter((header) => !columns.has(header));
  if (missingHeaders.length) {
    return failed(`Delta 模板缺少字段：${missingHeaders.join("、")}`, "DELTA");
  }
  const changes: MainMaterialDelta[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (let rowNumber = 8; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const operation = value(row, columns, "operation").toUpperCase();
    const materialId = value(row, columns, "material_id");
    if (!operation && !materialId) continue;
    const expectedRecordVersion = nonNegativeInteger(
      value(row, columns, "expected_record_version"),
    );
    const changeReason = value(row, columns, "change_reason");
    if (!(["UPSERT", "DEACTIVATE", "REACTIVATE"] as const).includes(operation as never)) {
      blockers.push(`第 ${rowNumber} 行 operation 无效`);
      continue;
    }
    if (!materialId || expectedRecordVersion === null) {
      blockers.push(`第 ${rowNumber} 行缺少 material_id 或期望版本`);
      continue;
    }
    if (ids.has(materialId)) blockers.push(`第 ${rowNumber} 行 material_id 重复`);
    ids.add(materialId);
    const values: Record<string, string | null> = {};
    for (const field of [
      "category_code", "category_name", "item_name", "brand", "series", "model",
      "spec", "color", "unit", "sale_price", "cost_price", "type", "wood_species",
      "substrate", "thickness", "grade", "lock_type", "packaging", "panel_size",
      "lighting_power", "data_status", "remarks",
    ]) {
      const raw = value(row, columns, field);
      if (!raw) continue;
      values[field] = raw === "[CLEAR]" ? null : raw;
    }
    if (!changeReason) blockers.push(`第 ${rowNumber} 行变更必须填写原因`);
    changes.push({
      changeReason,
      expectedRecordVersion,
      materialId,
      operation: operation as MainMaterialDelta["operation"],
      values,
    });
  }
  if (!changes.length) blockers.push("Delta 模板没有变更记录");
  return result("DELTA", changes, blockers, warnings);
}

function result(
  mode: MainMaterialImportMode,
  payload: ParsedMainMaterialWorkbook["payload"],
  blockers: readonly string[],
  warnings: readonly string[],
): ParsedMainMaterialWorkbook {
  return {
    mode,
    payload,
    validation: {
      blockerCount: blockers.length,
      blockers: blockers.slice(0, 100),
      itemCount: payload.length,
      pendingItemCount:
        mode === "FULL"
          ? (payload as readonly NormalizedMainMaterialItem[]).filter(
              (item) => item.status === "PENDING_DATA",
            ).length
          : 0,
      warningCount: warnings.length,
      warnings: warnings.slice(0, 100),
    },
  };
}

function failed(message: string, mode: MainMaterialImportMode): ParsedMainMaterialWorkbook {
  return result(mode, [], [message], []);
}

function headerMap(row: ExcelJS.Row): Map<string, number> {
  const result = new Map<string, number>();
  row.eachCell((target, index) => {
    const header = cellText(target);
    if (header) result.set(header, index);
  });
  return result;
}

function cell(row: ExcelJS.Row, columns: Map<string, number>, header: string): string {
  return value(row, columns, header);
}

function value(row: ExcelJS.Row, columns: Map<string, number>, header: string): string {
  const index = columns.get(header);
  return index ? cellText(row.getCell(index)) : "";
}

function cellText(cell: ExcelJS.Cell): string {
  const raw = cell.value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && "result" in raw) return String(raw.result ?? "").trim();
  return cell.text.trim();
}

function money(row: ExcelJS.Row, columns: Map<string, number>, header: string): string | null {
  const raw = value(row, columns, header).replaceAll(",", "").replace(/^¥/, "");
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) <= 0) return null;
  return Number(raw).toFixed(2);
}

function positiveInteger(raw: string): number | null {
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function nonNegativeInteger(raw: string): number | null {
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

function list(raw: string): string[] {
  return raw.split(/[；;]/).map((part) => part.trim()).filter(Boolean);
}

function requiredMissingFields(item: {
  readonly brand: string;
  readonly categoryCode: MainMaterialCategoryCode;
  readonly costPrice: string | null;
  readonly itemName: string;
  readonly model: string;
  readonly salePrice: string | null;
  readonly spec: string;
  readonly unit: string;
}): string[] {
  const missing: string[] = [];
  if (!item.itemName && !item.model) missing.push("品名/型号");
  if (!item.unit) missing.push("单位");
  if (!item.salePrice) missing.push("销售价");
  if (!item.costPrice) missing.push("成本价");
  if (item.categoryCode === "TILE" && !item.brand) missing.push("品牌");
  if (item.categoryCode === "TILE" && !item.spec) missing.push("规格");
  return missing;
}

function mergeMissingFields(current: string, required: readonly string[]): string {
  const values = current.split(/[、；;]/).map((value) => value.trim()).filter(Boolean);
  return [...new Set([...values, ...required])].join("、");
}

function isCategory(value: string): value is MainMaterialCategoryCode {
  return Object.prototype.hasOwnProperty.call(categoryNames, value);
}

function isStatus(value: string): value is NormalizedMainMaterialItem["status"] {
  return value === "ACTIVE" || value === "PENDING_DATA" || value === "INACTIVE";
}
