import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mapFullImportItem } from "../src/main-material/main-material-import-mapping";
import { describe, expect, it } from "vitest";

import { parseMainMaterialWorkbook } from "../src/main-material/main-material-workbook";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";

const headers = [
  "material_id", "分类代码", "分类", "品名/项目", "品牌", "系列/工艺",
  "型号", "规格", "可选颜色", "单位", "销售价", "成本价（敏感）",
  "产品图引用", "类型", "木种", "基材", "规格/面皮厚度", "等级",
  "锁扣", "包装", "面板尺寸", "照明功率", "数据状态", "record_version",
  "缺失字段", "来源文件", "来源工作表/页", "来源行/型号", "价格换算说明", "备注",
];

describe("main material workbook", () => {
  it("reads the 0919 namespaced workbook and preserves all published selection relations", async () => {
    const parsed = await parseMainMaterialWorkbook(await readFile(resolve(process.cwd(), "test/fixtures/main-material-0919.xlsx")), "FULL");
    expect(parsed.validation).toMatchObject({ itemCount: 694, pendingItemCount: 89, blockerCount: 0 });
    const baseline = JSON.parse(await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8")) as {
      items: (NormalizedMainMaterialItem & { assetIds: string[] })[];
    };
    const byId = new Map(baseline.items.map((item) => [item.materialId, item]));
    const items = (parsed.payload as NormalizedMainMaterialItem[]).map((i) => mapFullImportItem(i, byId.get(i.materialId)));
    expect(items.filter((i) => i.status === "ACTIVE")).toHaveLength(601);
    expect(items.filter((i) => i.status === "INACTIVE")).toHaveLength(4);
    expect(items.filter((i) => i.model.startsWith("20K")).every((i) => i.status === "ACTIVE")).toBe(true);
    expect(items.every((i) => i.recordVersion > (byId.get(i.materialId)?.recordVersion ?? 0))).toBe(true);
    const doors = items.filter((i) => i.categoryCode === "GLASS_DOOR");
    expect(doors).toHaveLength(22);
    for (const i of doors) {
      expect(Object.keys(JSON.parse(i.attributes.colorAssetMap!))).toEqual(i.colors);
      expect(JSON.parse(i.attributes.glassColors!)).toHaveLength(i.materialId === "MAT-GLASS_DOOR-FBACE026D73F" ? 0 : 6);
    }
    expect(new Set(items.filter((i) => i.attributes.variantGroup?.startsWith("定制浴室柜:")).map((i) => i.attributes.variantGroup)).size).toBe(4);
    expect(items.filter((i) => i.attributes.variantGroup?.startsWith("顾朗:")).length).toBeGreaterThan(60);
  });
  it("keeps source tracing and automatically moves incomplete active rows to pending", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("主材库");
    sheet.getRow(4).values = headers;
    sheet.getRow(5).values = headers.map((header) => ({
      material_id: "MAT-TILE-TEST",
      分类代码: "TILE",
      分类: "瓷砖",
      "品名/项目": "瓷砖",
      品牌: "测试品牌",
      型号: "TEST-01",
      规格: "750*1500",
      单位: "M2",
      产品图引用: "source-image-01",
      数据状态: "ACTIVE",
      record_version: "1",
      来源文件: "主材库/测试.xlsx",
      "来源工作表/页": "Sheet1",
      "来源行/型号": "5",
      价格换算说明: "按片换算",
    } as Record<string, string>)[header] ?? "");
    const parsed = await parseMainMaterialWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "FULL",
    );
    const item = parsed.payload[0] as NormalizedMainMaterialItem;
    expect(parsed.validation.blockerCount).toBe(0);
    expect(item).toMatchObject({
      materialId: "MAT-TILE-TEST",
      missingFields: "销售价、成本价",
      priceDerivation: "按片换算",
      sourceFile: "主材库/测试.xlsx",
      sourceRow: "5",
      sourceSheet: "Sheet1",
      status: "PENDING_DATA",
    });
    expect(item.attributes.imageReference).toBe("source-image-01");
  });

  it("builds cabinet group and colour mappings while importing source material names", async () => {
    const parsed = await parseMainMaterialWorkbook(await cabinetWorkbook("洞石米白"), "FULL");
    expect(parsed.validation.blockerCount).toBe(0);
    expect(parsed.payload[0]).toMatchObject({
      materialId: "MAT-BATHROOM-DD50EBFFF7E0",
      model: "免漆浴室柜（主卫）",
      colors: ["德利丰（大板）-洞石米白"],
      salePrice: "4500.00",
      costPrice: "2800.00",
      unit: "M",
      sourceRow: "97",
      attributes: {
        variantGroup: "定制浴室柜:免漆浴室柜（主卫）",
        variantColor: "德利丰（大板）-洞石米白",
        imageReference: "xlsx://主材库/定制浴室柜主材库_v1.xlsx#Sheet1!row=97;count=1",
      },
    });
  });

  it("reports an ambiguous cabinet mapping as an import blocker", async () => {
    const parsed = await parseMainMaterialWorkbook(await cabinetWorkbook("洞石米白；蓝水晶"), "FULL");
    expect(parsed.validation.blockers).toContain(
      "MAT-BATHROOM-DD50EBFFF7E0：每条定制浴室柜记录必须对应一个核心主材颜色",
    );
  });

  it("blocks a Delta row without a change reason", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Delta导入模板");
    sheet.getRow(7).values = [
      "operation", "material_id", "expected_record_version", "change_reason", "model",
    ];
    sheet.getRow(8).values = ["UPSERT", "MAT-TILE-TEST", "1", "", "TEST-02"];
    const parsed = await parseMainMaterialWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "DELTA",
    );
    expect(parsed.validation.blockers).toContain("第 8 行变更必须填写原因");
  });
});

async function cabinetWorkbook(color: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("主材库");
  sheet.getRow(4).values = headers;
  const values: Record<string, string> = {
    material_id: "MAT-BATHROOM-DD50EBFFF7E0", 分类代码: "BATHROOM", 分类: "卫浴",
    "品名/项目": "免漆浴室柜（主卫）", 品牌: "铂屿定制", 型号: "德利丰-洞石米白",
    规格: "1600*3200*12", 可选颜色: color, 单位: "M", 销售价: "4500", "成本价（敏感）": "2800",
    产品图引用: "xlsx://主材库/定制浴室柜主材库_v1.xlsx#Sheet1!row=97;count=1",
    数据状态: "ACTIVE", record_version: "4", 来源文件: "主材库/定制浴室柜主材库_v1.xlsx",
    "来源工作表/页": "Sheet1", "来源行/型号": "97",
  };
  sheet.getRow(5).values = headers.map((header) => values[header] ?? "");
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
