import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { category } from "../src/main-material/main-material-direct-plan";
import ExcelJS from "exceljs";
import { parseMainMaterialWorkbook } from "../src/main-material/main-material-workbook";
import { readMainMaterialXlsx } from "../src/main-material/main-material-xlsx-reader";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";

describe("art paint category and narrowly scoped catalog update", () => {
  it("recognizes the new category without changing existing categories", () => {
    expect(category("艺术漆")).toBe("ART_PAINT");
    expect(category("ART_PAINT")).toBe("ART_PAINT");
    expect(category("瓷砖")).toBe("TILE");
  });

  it("round trips all eight source items through the existing FULL workbook", async () => {
    const patch = JSON.parse(await readFile("assets/main-materials/v1/catalog-0929-art-paint.json", "utf8"));
    const workbook = new ExcelJS.Workbook();
    const original = await readMainMaterialXlsx(await readFile("test/fixtures/main-material-0919.xlsx"));
    const sheet = workbook.addWorksheet("主材库");
    sheet.getRow(4).values = original.getWorksheet("主材库")!.getRow(4).values;
    const fields = ["materialId", "categoryCode", "categoryName", "itemName", "brand", "series", "model", "spec", "colors", "unit", "salePrice", "costPrice"];
    for (const item of patch.items) {
      const row = sheet.addRow(fields.map(key => key === "colors" ? item.colors.join("；") : item[key]));
      for (const [column, field] of [[23, "status"], [24, "recordVersion"], [25, "missingFields"], [26, "sourceFile"], [27, "sourceSheet"], [28, "sourceRow"], [29, "priceDerivation"], [30, "remarks"]] as const) row.getCell(column).value = item[field];
    }
    const parsed = await parseMainMaterialWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "FULL");
    expect(parsed.validation.blockerCount).toBe(0);
    const items = parsed.payload as NormalizedMainMaterialItem[];
    expect(items).toHaveLength(8);
    expect(items.map(item => [item.itemName, item.salePrice, item.costPrice])).toEqual([
      ["北欧绮遇", "88.00", "40.00"], ["北欧之家", "110.00", "50.00"],
      ["秘境", "130.00", "60.00"], ["之纯", "150.00", "70.00"],
      ["岩彩", "188.00", "80.00"], ["雅晶石", "110.00", "55.00"],
      ["天鹅绒", "120.00", "65.00"], ["石灰岩", "150.00", "70.00"],
    ]);
    for (const item of items) expect(item).toMatchObject({ categoryCode: "ART_PAINT", categoryName: "艺术漆", unit: "M²", status: "ACTIVE", model: "", spec: "", colors: [] });
    expect(new Set(items.map(item => item.materialId)).size).toBe(8);
    expect(patch.switchPrices).toHaveLength(3);
    expect(patch.switchPrices.every((item: { salePrice: string }) => item.salePrice === "20.00")).toBe(true);
  });
});
