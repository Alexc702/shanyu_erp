import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import ExcelJS from "exceljs";
import pg from "pg";

const { Pool } = pg;
const sourcePath = resolve(process.cwd(), "../../../半包报价单_v5.xlsx");
const expectedSections = [
  { code: "WALL", endRow: 24, name: "一、砌墙工程", startRow: 6 },
  { code: "LIVING_DINING", endRow: 78, name: "二、客餐厅工程", startRow: 27 },
  { code: "BEDROOM", endRow: 127, name: "三、卧室工程", startRow: 81 },
  { code: "BALCONY", endRow: 132, name: "七、阳台工程", startRow: 130 },
  {
    code: "KITCHEN_BATHROOM",
    endRow: 168,
    name: "八、厨卫工程",
    startRow: 135,
  },
  { code: "PAINT", endRow: 174, name: "十、油漆工程", startRow: 172 },
  {
    code: "ELECTRICAL",
    endRow: 193,
    name: "十一、水电工程",
    startRow: 177,
  },
  { code: "OTHER", endRow: 198, name: "十二、其他工程", startRow: 196 },
];

const sourceBuffer = await readFile(sourcePath);
const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(sourceBuffer);
const sheet = workbook.getWorksheet("半包报价模板");
if (!sheet) {
  throw new Error("源 Excel 缺少“半包报价模板”工作表");
}

const sourceSections = expectedSections.map((section, index) => ({
  code: section.code,
  item_count: section.endRow - section.startRow + 1,
  name: section.name,
  sort_order: index,
}));
const sourceItems = expectedSections.flatMap((section) =>
  Array.from(
    { length: section.endRow - section.startRow + 1 },
    (_, rowOffset) => {
      const sourceRow = section.startRow + rowOffset;
      const row = sheet.getRow(sourceRow);
      const quantityValue = row.getCell(6).value;
      return {
        cost_unit_price: decimalText(row.getCell(10).value),
        item_name: text(row.getCell(3).text),
        quantity_formula: formulaText(quantityValue),
        raw_quantity: nullableText(row.getCell(6).text),
        remarks: nullableText(row.getCell(9).text),
        sale_unit_price: decimalText(row.getCell(7).value),
        section_code: section.code,
        section_name: section.name,
        sort_order: sourceRow,
        source_row: sourceRow,
        unit: text(row.getCell(5).text),
      };
    },
  ),
);

const pool = new Pool({
  database: requiredEnvironmentVariable("POSTGRES_DB"),
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  password: requiredEnvironmentVariable("POSTGRES_PASSWORD"),
  port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  user: requiredEnvironmentVariable("POSTGRES_USER"),
});

try {
  const versionResult = await pool.query(`
    SELECT v.id, v.version_number, b.file_hash
      FROM half_package_template_versions v
      JOIN catalog_import_batches b ON b.id = v.source_batch_id
     ORDER BY v.version_number DESC
     LIMIT 1
  `);
  const version = versionResult.rows[0];
  if (!version) {
    throw new Error("数据库中没有已发布的半包主材库版本");
  }

  const sectionResult = await pool.query(
    `SELECT code, name, sort_order, item_count
       FROM half_package_sections
      WHERE template_version_id = $1
      ORDER BY sort_order`,
    [version.id],
  );
  const itemResult = await pool.query(
    `SELECT s.code AS section_code, s.name AS section_name,
            i.item_name, i.unit, i.raw_quantity, i.quantity_formula,
            i.remarks, i.sort_order, source.source_row,
            price.sale_unit_price, price.cost_unit_price
       FROM half_package_version_items i
       JOIN half_package_sections s ON s.id = i.section_id
       JOIN catalog_import_items source ON source.id = i.source_import_item_id
       JOIN half_package_item_price_versions price ON price.version_item_id = i.id
      WHERE i.template_version_id = $1
      ORDER BY source.source_row`,
    [version.id],
  );

  const differences = [];
  compareValue(differences, "文件 SHA-256", sourceHash, version.file_hash.trim());
  compareValue(differences, "分区数", sourceSections.length, sectionResult.rows.length);
  compareValue(differences, "工程项数", sourceItems.length, itemResult.rows.length);

  for (const [index, source] of sourceSections.entries()) {
    const actual = sectionResult.rows[index];
    if (!actual) {
      differences.push({ field: "分区", source: source.name, database: null });
      continue;
    }
    for (const field of ["code", "name", "sort_order", "item_count"]) {
      compareValue(
        differences,
        `分区 ${index + 1} ${field}`,
        source[field],
        actual[field],
      );
    }
  }

  const databaseBySourceRow = new Map(
    itemResult.rows.map((item) => [Number(item.source_row), item]),
  );
  for (const source of sourceItems) {
    const actual = databaseBySourceRow.get(source.source_row);
    if (!actual) {
      differences.push({
        field: "工程项",
        source: source.item_name,
        database: null,
        sourceRow: source.source_row,
      });
      continue;
    }
    for (const field of [
      "section_code",
      "section_name",
      "source_row",
      "item_name",
      "unit",
      "raw_quantity",
      "quantity_formula",
      "sale_unit_price",
      "cost_unit_price",
      "remarks",
    ]) {
      compareValue(
        differences,
        field,
        normalizeComparable(source[field]),
        normalizeComparable(actual[field]),
        source.source_row,
      );
    }
  }

  const report = {
    differenceCount: differences.length,
    differences: differences.slice(0, 50),
    publishedVersion: Number(version.version_number),
    sourceFile: sourcePath,
    sourceHash,
    verifiedItemCount: sourceItems.length,
    verifiedSectionCount: sourceSections.length,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (differences.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

function compareValue(differences, field, source, database, sourceRow) {
  if (source !== database) {
    differences.push({ database, field, source, sourceRow });
  }
}

function decimalText(value) {
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    return "";
  }
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(4, "0").slice(0, 4)}`;
}

function formulaText(value) {
  return value &&
    typeof value === "object" &&
    "formula" in value &&
    typeof value.formula === "string"
    ? value.formula
    : null;
}

function normalizeComparable(value) {
  return typeof value === "string" ? value.trim() : value ?? null;
}

function nullableText(value) {
  const result = text(value);
  return result || null;
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function text(value) {
  return value.trim();
}
