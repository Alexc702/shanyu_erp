import ExcelJS from "exceljs";

const sourceSheetName = "半包报价模板";

const expectedSections = [
  { code: "WALL", endRow: 24, headerRow: 5, name: "一、砌墙工程", startRow: 6 },
  { code: "LIVING_DINING", endRow: 71, headerRow: 26, name: "二、客餐厅工程", startRow: 27 },
  { code: "BEDROOM", endRow: 113, headerRow: 73, name: "三、卧室工程", startRow: 74 },
  { code: "BALCONY", endRow: 118, headerRow: 115, name: "七、阳台工程", startRow: 116 },
  { code: "KITCHEN_BATHROOM", endRow: 147, headerRow: 120, name: "八、厨卫工程", startRow: 121 },
  { code: "PAINT", endRow: 153, headerRow: 150, name: "十、油漆工程", startRow: 151 },
  { code: "ELECTRICAL", endRow: 172, headerRow: 155, name: "十一、水电工程", startRow: 156 },
  { code: "OTHER", endRow: 177, headerRow: 174, name: "十二、其他工程", startRow: 175 },
] as const;

const knownBlankRemarkRows = new Set([56, 101, 163]);

export interface HalfPackageWorkbookItem {
  readonly costUnitPrice: string;
  readonly itemName: string;
  readonly quantityFormula: string | null;
  readonly rawQuantity: string | null;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionName: string;
  readonly sortOrder: number;
  readonly sourceRow: number;
  readonly unit: string;
}

export interface HalfPackageWorkbookSection {
  readonly code: (typeof expectedSections)[number]["code"];
  readonly itemCount: number;
  readonly name: string;
  readonly sortOrder: number;
}

export interface HalfPackageWorkbookValidation {
  readonly blockers: readonly string[];
  readonly items: readonly HalfPackageWorkbookItem[];
  readonly report: {
    readonly blockerCount: number;
    readonly costPriceCount: number;
    readonly formulaCount: number;
    readonly itemCount: number;
    readonly salePriceCount: number;
    readonly sectionCount: number;
    readonly warningSourceRows: readonly number[];
  };
  readonly sections: readonly HalfPackageWorkbookSection[];
}

export async function validateHalfPackageWorkbook(
  buffer: Buffer,
): Promise<HalfPackageWorkbookValidation> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet(sourceSheetName);
  if (!sheet) {
    return emptyValidation([`缺少工作表“${sourceSheetName}”`]);
  }

  const items: HalfPackageWorkbookItem[] = [];
  const sections: HalfPackageWorkbookSection[] = [];
  const warningSourceRows: number[] = [];
  const sectionBlockers: string[] = [];

  for (const [sectionIndex, section] of expectedSections.entries()) {
    if (sectionHeaderText(sheet.getRow(section.headerRow).getCell(3).text) !== section.name) {
      sectionBlockers.push(
        `Excel 第 ${section.headerRow} 行报价分区应为“${section.name}”`,
      );
    }
    let sectionItemCount = 0;
    for (let sourceRow = section.startRow; sourceRow <= section.endRow; sourceRow += 1) {
      const row = sheet.getRow(sourceRow);
      const itemName = normalizedText(row.getCell(3).text);
      const unit = normalizedText(row.getCell(5).text);
      const remarks = optionalText(row.getCell(9).text);
      const quantityCell = row.getCell(6);
      const quantityFormula = formulaText(quantityCell.value);

      items.push({
        costUnitPrice: decimalText(row.getCell(10).value),
        itemName,
        quantityFormula,
        rawQuantity: optionalText(quantityCell.text),
        remarks,
        saleUnitPrice: decimalText(row.getCell(7).value),
        sectionName: section.name,
        sortOrder: items.length,
        sourceRow,
        unit,
      });
      sectionItemCount += 1;
      if (!remarks && knownBlankRemarkRows.has(sourceRow)) {
        warningSourceRows.push(sourceRow);
      }
    }
    sections.push({
      code: section.code,
      itemCount: sectionItemCount,
      name: section.name,
      sortOrder: sectionIndex,
    });
  }

  const blockers = [...sectionBlockers, ...validateParsedItems(items, sections)];
  const salePriceCount = items.filter((item) => item.saleUnitPrice).length;
  const costPriceCount = items.filter((item) => item.costUnitPrice).length;

  return {
    blockers,
    items,
    report: {
      blockerCount: blockers.length,
      costPriceCount,
      formulaCount: items.filter((item) => item.quantityFormula).length,
      itemCount: items.length,
      salePriceCount,
      sectionCount: sections.length,
      warningSourceRows,
    },
    sections,
  };
}

function validateParsedItems(
  items: readonly HalfPackageWorkbookItem[],
  sections: readonly HalfPackageWorkbookSection[],
): string[] {
  const blockers: string[] = [];
  if (sections.length !== 8) {
    blockers.push(`报价分区应为 8 个，实际为 ${sections.length} 个`);
  }
  if (items.length !== 157) {
    blockers.push(`标准工程项应为 157 项，实际为 ${items.length} 项`);
  }
  for (const item of items) {
    if (!item.itemName || !item.unit) {
      blockers.push(`Excel 第 ${item.sourceRow} 行缺少工程项名称或单位`);
    }
    if (!item.saleUnitPrice || !item.costUnitPrice) {
      blockers.push(`Excel 第 ${item.sourceRow} 行缺少销售价或成本价`);
    }
    if (!item.remarks && !knownBlankRemarkRows.has(item.sourceRow)) {
      blockers.push(`Excel 第 ${item.sourceRow} 行缺少施工说明`);
    }
  }
  return blockers;
}

function emptyValidation(blockers: readonly string[]): HalfPackageWorkbookValidation {
  return {
    blockers,
    items: [],
    report: {
      blockerCount: blockers.length,
      costPriceCount: 0,
      formulaCount: 0,
      itemCount: 0,
      salePriceCount: 0,
      sectionCount: 0,
      warningSourceRows: [],
    },
    sections: [],
  };
}

function formulaText(value: ExcelJS.CellValue): string | null {
  if (
    value &&
    typeof value === "object" &&
    "formula" in value &&
    typeof value.formula === "string"
  ) {
    return value.formula;
  }
  return null;
}

function decimalText(value: ExcelJS.CellValue): string {
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) <= 0) {
    return "";
  }
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(4, "0").slice(0, 4)}`;
}

function normalizedText(value: string): string {
  return value.trim();
}

function sectionHeaderText(value: string): string {
  return normalizedText(value).replace(/^【|】$/g, "");
}

function optionalText(value: string): string | null {
  const normalized = normalizedText(value);
  return normalized || null;
}
