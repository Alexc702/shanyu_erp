import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseMainMaterialWorkbook } from "../src/main-material/main-material-workbook";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";

describe("main material workbook", () => {
  it("keeps source tracing and automatically moves incomplete active rows to pending", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("主材库");
    const headers = [
      "material_id", "分类代码", "分类", "品名/项目", "品牌", "系列/工艺",
      "型号", "规格", "可选颜色", "单位", "销售价", "成本价（敏感）",
      "产品图引用", "类型", "木种", "基材", "规格/面皮厚度", "等级",
      "锁扣", "包装", "面板尺寸", "照明功率", "数据状态", "record_version",
      "缺失字段", "来源文件", "来源工作表/页", "来源行/型号", "价格换算说明", "备注",
    ];
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
