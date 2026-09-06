import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { validateHalfPackageWorkbook } from "../src/catalog/half-package-workbook";

describe("validateHalfPackageWorkbook", () => {
  it("validates the confirmed 8-section and 178-item V5 workbook", async () => {
    const workbook = await readFile(
      resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
    );

    const result = await validateHalfPackageWorkbook(workbook);

    expect(result.report).toEqual({
      blockerCount: 0,
      costPriceCount: 178,
      formulaCount: 39,
      itemCount: 178,
      salePriceCount: 178,
      sectionCount: 8,
      warningSourceRows: [63, 115, 184],
    });
    expect(result.sections.map(({ itemCount, name }) => [name, itemCount])).toEqual([
      ["一、砌墙工程", 19],
      ["二、客餐厅工程", 52],
      ["三、卧室工程", 47],
      ["七、阳台工程", 3],
      ["八、厨卫工程", 34],
      ["十、油漆工程", 3],
      ["十一、水电工程", 17],
      ["十二、其他工程", 3],
    ]);
    expect(result.items).toHaveLength(178);
    expect(result.items.find(({ sourceRow }) => sourceRow === 6)).toMatchObject({
      itemName: "内墙顶涂料铲除及打毛处理",
      remarks:
        "1、人工费；\n2、垃圾装袋运至小区指定点，如需要运到小区外费用另计。",
    });
    expect(result.items.find(({ sourceRow }) => sourceRow === 27)).toMatchObject({
      costUnitPrice: "100.0000",
      itemName: "门槛石安装",
      saleUnitPrice: "100.0000",
      sectionName: "二、客餐厅工程",
      unit: "M",
    });
    expect(result.items.find(({ sourceRow }) => sourceRow === 135)).toMatchObject({
      costUnitPrice: "50.0000",
      itemName: "门槛石安装",
      saleUnitPrice: "100.0000",
      sectionName: "八、厨卫工程",
      unit: "M",
    });
    expect(result.items.filter(({ sourceRow }) => [36, 37, 38, 47].includes(sourceRow))).toMatchObject([
      {
        costUnitPrice: "115.0000",
        itemName: "多规格古堡砖（水泥砂浆粘贴）",
        remarks:
          "200*200 / 200*400 / 400*400 / 400*600 拼砖\n水泥黄沙铺贴，斜铺、错缝、不规则、走边铺贴费用另计，不含美缝、胶泥。",
        saleUnitPrice: "185.0000",
        unit: "M2",
      },
      {
        costUnitPrice: "120.0000",
        itemName: "木纹砖长条150*900（水泥砂浆粘贴）",
        saleUnitPrice: "195.0000",
        unit: "M2",
      },
      {
        costUnitPrice: "120.0000",
        itemName: "木纹砖长条200*1200（水泥砂浆粘贴）",
        saleUnitPrice: "190.0000",
        unit: "M2",
      },
      {
        costUnitPrice: "5.0000",
        itemName: "斜铺/人字贴人工费",
        remarks: "斜铺/人字贴人工费补差",
        saleUnitPrice: "10.0000",
        unit: "M2",
      },
    ]);
    expect(result.items.find(({ itemName }) => itemName === "正泰空开更换")).toMatchObject({
      costUnitPrice: "5.0000",
    });
    expect(
      result.items
        .filter(({ sourceRow }) => [48, 100, 160].includes(sourceRow))
        .map(({ itemName, remarks, sourceRow }) => ({ itemName, remarks, sourceRow })),
    ).toEqual([
      {
        itemName: "（薄贴）瓷砖增加人工费",
        remarks: "薄贴人工费补差",
        sourceRow: 48,
      },
      {
        itemName: "（薄贴）瓷砖增加人工费",
        remarks: "薄贴人工费补差",
        sourceRow: 100,
      },
      {
        itemName: "（薄贴）瓷砖增加人工费",
        remarks: "薄贴人工费补差",
        sourceRow: 160,
      },
    ]);
    expect(
      result.items
        .filter(({ sourceRow }) => [50, 102, 142].includes(sourceRow))
        .map(({ itemName, remarks, sourceRow }) => ({ itemName, remarks, sourceRow })),
    ).toEqual([
      {
        itemName: "瓜子片豆石精找平",
        remarks:
          "水泥黄沙瓜子片豆石精找平（地砖薄贴专用，误差3mm）（厚度3到5cm）",
        sourceRow: 50,
      },
      {
        itemName: "瓜子片豆石精找平",
        remarks:
          "水泥黄沙瓜子片豆石精找平（地砖薄贴专用，误差3mm）（厚度3到5cm）",
        sourceRow: 102,
      },
      {
        itemName: "瓜子片豆石精找平",
        remarks:
          "水泥黄沙瓜子片豆石精找平（地砖博贴专用，误差3mm）（厚度3到5cm）",
        sourceRow: 142,
      },
    ]);
  });

  it(
    "locates blocking section and price differences by Excel row",
    async () => {
      const source = await readFile(
        resolve(process.cwd(), "../../../半包报价单_v5.xlsx"),
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
        costPriceCount: 177,
        warningSourceRows: [63, 115, 184],
      });
      expect(result.blockers).toEqual([
        "Excel 第 26 行报价分区应为“二、客餐厅工程”",
        "Excel 第 27 行缺少销售价或成本价",
      ]);
    },
    15_000,
  );
});
