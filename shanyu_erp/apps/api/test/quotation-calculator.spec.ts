import ExcelJS from "exceljs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HalfPackageCalculator,
  type QuotationCalculationInput,
} from "../src/quotation/half-package-calculator";

describe("HalfPackageCalculator", () => {
  const calculator = new HalfPackageCalculator();

  it("calculates confirmed project, space, and stable-line rules to four decimals", () => {
    const result = calculator.calculate({
      buildingArea: "130.0000",
      managementRate: "0.1000",
      scopes: [
        {
          area: "20.0000",
          height: "2.9100",
          id: "bedroom",
          lines: [
            line("ceiling-base", "47.0000", { kind: "SPACE_AREA" }),
            line("ceiling-paint", "18.0000", {
              kind: "LINE_REFERENCE",
              referencedLineId: "ceiling-base",
            }),
            line("wall-base", "47.0000", {
              kind: "SPACE_PERIMETER_HEIGHT",
            }),
            line("wall-paint", "18.0000", {
              kind: "LINE_REFERENCE",
              referencedLineId: "wall-base",
            }),
          ],
          perimeter: "20.0000",
        },
        {
          area: null,
          height: null,
          id: "common",
          lines: [
            line("electrical", "15.5000", {
              kind: "PROJECT_BUILDING_AREA",
            }),
          ],
          perimeter: null,
        },
      ],
    });

    expect(result.scopes[0]?.lines).toMatchObject([
      { amount: "940.0000", id: "ceiling-base", quantity: "20.0000" },
      { amount: "360.0000", id: "ceiling-paint", quantity: "20.0000" },
      { amount: "2735.4000", id: "wall-base", quantity: "58.2000" },
      { amount: "1047.6000", id: "wall-paint", quantity: "58.2000" },
    ]);
    expect(result.scopes[1]?.lines[0]).toMatchObject({
      amount: "2015.0000",
      quantity: "130.0000",
    });
    expect(result).toMatchObject({
      directCost: "7098.0000",
      managementFee: "709.8000",
      total: "7807.8000",
    });
  });

  it("keeps blank manual quantities and unselected automatic items out of totals", () => {
    const result = calculator.calculate({
      buildingArea: "100.0000",
      managementRate: "0.1000",
      scopes: [
        {
          area: "18.0000",
          height: "2.8000",
          id: "scope",
          lines: [
            line("blank", "100.0000", { kind: "MANUAL" }, null),
            { ...line("off", "12.0000", { kind: "SPACE_AREA" }), selected: false },
            line("manual", "15.5000", { kind: "MANUAL" }, "1.2345"),
          ],
          perimeter: "17.0000",
        },
      ],
    });

    expect(result.scopes[0]?.lines).toMatchObject([
      { amount: null, id: "blank", quantity: null },
      { amount: null, id: "off", quantity: null },
      { amount: "19.1348", id: "manual", quantity: "1.2345" },
    ]);
    expect(result).toMatchObject({
      directCost: "19.1348",
      managementFee: "1.9135",
      total: "21.0483",
    });
  });

  it("matches all 157 cached Excel quantities, line amounts, and summary values", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(
      resolve(process.cwd(), "../../../半包报价单_v2.xlsx"),
    );
    const sheet = workbook.getWorksheet("半包报价模板");
    if (!sheet) {
      throw new Error("源文件缺少半包报价模板");
    }
    const ranges = [
      [6, 24, 25],
      [27, 71, 72],
      [74, 113, 114],
      [116, 118, 119],
      [121, 147, 148],
      [151, 153, 154],
      [156, 172, 173],
      [175, 177, 178],
    ] as const;
    const scopes: QuotationCalculationInput["scopes"] = ranges.map(
      ([start, end], scopeIndex) => ({
        area: null,
        height: null,
        id: `source-section-${scopeIndex}`,
        lines: Array.from({ length: end - start + 1 }, (_, index) => {
          const sourceRow = start + index;
          const row = sheet.getRow(sourceRow);
          const quantity = numericCellResult(row.getCell(6).value);
          return line(
            `source-row-${sourceRow}`,
            decimal4(numericCellResult(row.getCell(7).value) ?? 0),
            { kind: "MANUAL" },
            quantity === null || quantity === 0 ? null : decimal4(quantity),
          );
        }),
        perimeter: null,
      }),
    );

    const result = calculator.calculate({
      buildingArea: "130.0000",
      managementRate: "0.1000",
      scopes,
    });

    expect(result.scopes.flatMap((scope) => scope.lines)).toHaveLength(157);
    for (const scope of result.scopes) {
      for (const calculated of scope.lines) {
        const sourceRow = Number(calculated.id.replace("source-row-", ""));
        const expectedQuantity = numericCellResult(
          sheet.getRow(sourceRow).getCell(6).value,
        );
        const expectedAmount = numericCellResult(
          sheet.getRow(sourceRow).getCell(8).value,
        );
        expect(calculated.quantity, `Excel 第 ${sourceRow} 行数量`).toBe(
          expectedQuantity === null || expectedQuantity === 0
            ? null
            : decimal4(expectedQuantity),
        );
        expect(calculated.amount, `Excel 第 ${sourceRow} 行金额`).toBe(
          expectedAmount === null || expectedAmount === 0
            ? null
            : decimal4(expectedAmount),
        );
      }
    }
    for (const [scopeIndex, [, , subtotalRow]] of ranges.entries()) {
      expect(result.scopes[scopeIndex]?.subtotal, `Excel 第 ${subtotalRow} 行小计`).toBe(
        decimal4(numericCellResult(sheet.getRow(subtotalRow).getCell(8).value) ?? 0),
      );
    }
    expect(result.directCost).toBe(decimal4(requiredCellResult(sheet, "G180")));
    expect(result.managementFee).toBe(
      decimal4(requiredCellResult(sheet, "G181")),
    );
    expect(result.total).toBe(decimal4(requiredCellResult(sheet, "G183")));
  });
});

function line(
  id: string,
  saleUnitPrice: string,
  quantityRule: QuotationCalculationInput["scopes"][number]["lines"][number]["quantityRule"],
  manualQuantity: string | null = null,
): QuotationCalculationInput["scopes"][number]["lines"][number] {
  return {
    id,
    manualQuantity,
    quantityRule,
    saleUnitPrice,
    selected: true,
  };
}

function requiredCellResult(sheet: ExcelJS.Worksheet, address: string): number {
  const value = numericCellResult(sheet.getCell(address).value);
  if (value === null) {
    throw new Error(`${address} 缺少数值结果`);
  }
  return value;
}

function numericCellResult(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    typeof value.result === "number"
  ) {
    return value.result;
  }
  return null;
}

function decimal4(value: number): string {
  return value.toFixed(4);
}
