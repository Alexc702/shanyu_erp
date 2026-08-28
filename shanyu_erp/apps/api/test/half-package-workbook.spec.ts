import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { validateHalfPackageWorkbook } from "../src/catalog/half-package-workbook";

describe("validateHalfPackageWorkbook", () => {
  it("validates the confirmed 8-section and 157-item source workbook", async () => {
    const workbook = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v2.xlsx"),
    );

    const result = await validateHalfPackageWorkbook(workbook);

    expect(result.report).toEqual({
      blockerCount: 0,
      costPriceCount: 157,
      formulaCount: 41,
      itemCount: 157,
      salePriceCount: 157,
      sectionCount: 8,
      warningSourceRows: [56, 101, 163],
    });
    expect(result.sections.map(({ itemCount, name }) => [name, itemCount])).toEqual([
      ["一、砌墙工程", 19],
      ["二、客餐厅工程", 45],
      ["三、卧室工程", 40],
      ["七、阳台工程", 3],
      ["八、厨卫工程", 27],
      ["十、油漆工程", 3],
      ["十一、水电工程", 17],
      ["十二、其他工程", 3],
    ]);
    expect(result.items).toHaveLength(157);
    expect(result.items.find(({ sourceRow }) => sourceRow === 27)).toMatchObject({
      costUnitPrice: "100.0000",
      itemName: "门槛石安装",
      saleUnitPrice: "120.0000",
      sectionName: "二、客餐厅工程",
      unit: "M",
    });
    expect(result.items.find(({ sourceRow }) => sourceRow === 121)).toMatchObject({
      costUnitPrice: "50.0000",
      itemName: "门槛石安装",
      saleUnitPrice: "100.0000",
      sectionName: "八、厨卫工程",
      unit: "M",
    });
  });

  it("locates blocking section and price differences by Excel row", async () => {
    const source = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v2.xlsx"),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      source as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("半包报价模板");
    if (!sheet) {
      throw new Error("测试源文件缺少半包报价模板");
    }
    sheet.getCell("C26").value = "二、错误分区";
    sheet.getCell("J27").value = 0;

    const serialized = await workbook.xlsx.writeBuffer();
    const result = await validateHalfPackageWorkbook(
      Buffer.from(serialized as unknown as Uint8Array),
    );

    expect(result.report).toMatchObject({
      blockerCount: 2,
      costPriceCount: 156,
      warningSourceRows: [56, 101, 163],
    });
    expect(result.blockers).toEqual([
      "Excel 第 26 行报价分区应为“二、客餐厅工程”",
      "Excel 第 27 行缺少销售价或成本价",
    ]);
  });
});
