import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { MainMaterialQuotation } from "../src/main-material/main-material.repository";
import { QuotationExporter } from "../src/quotation/quotation-exporter";
import type { QuotationDraft } from "../src/quotation/quotation.repository";

describe("QuotationExporter main material sheets", () => {
  const exporter = new QuotationExporter();

  it("physically removes cost data from the customer workbook and keeps empty categories", async () => {
    const exported = await exporter.generate(quotation, "XLSX", "陆女士", mainMaterial, "CLIENT");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.payload as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("主材报价单");
    expect(sheet).toBeDefined();
    expect(sheet?.columnCount).toBe(9);
    expect(sheet?.getCell("J4").value).toBeNull();
    expect(sheet?.getCell("A1").text).toBe("主材报价明细表");
    expect(sheet?.getCell("G2").value).toBe(130);
    expect(sheet?.getCell("I2").value).toBe("上海市长宁区示例项目");
    expect(sheet?.getCell("B4").master.address).toBe("A3");
    expect(sheet?.getCell("C4").master.address).toBe("C3");
    expect(sheet?.getCell("H3").master.address).toBe("G3");
    expect(sheet?.getCell("I4").master.address).toBe("I3");

    const firstColumn = sheet?.getColumn(1).values.map(String) ?? [];
    expect(firstColumn.filter((value) => value.startsWith("【"))).toHaveLength(11);
    expect(firstColumn.filter((value) => value === "小计：")).toHaveLength(10);
    expect(sheet?.getColumn(3).values.map(String)).toContain("瓷砖 · TI0T");
    expect(sheet?.getColumn(3).values.map(String)).not.toContain("不应导出");
    expect(sheet?.getColumn(3).values.map(String).slice(-3)).toEqual([
      "直接费",
      "服务费",
      "总造价",
    ]);
  }, 20_000);

  it("marks internal XLSX and includes the main-material cost column", async () => {
    const exported = await exporter.generate(quotation, "XLSX", "陆女士", mainMaterial, "INTERNAL");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.payload as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("主材报价单");
    expect(sheet?.getCell("A1").text).toContain("内部版");
    expect(sheet?.getCell("J4").value).toBe("成本（内部）");
    expect(sheet?.getColumn(10).values).toContain(800);
    expect(exported.fileName).toContain("内部版");
  }, 20_000);
});

const quotation: QuotationDraft = {
  adjustmentReason: "客户沟通后整单优惠",
  adjustmentStatus: "CONFIRMED",
  adjustedTotal: "150.0000",
  costTemplateVersionId: "cost-template",
  costTemplateVersionNumber: 5,
  createdByUserId: "user",
  decidedAt: new Date("2026-09-08T00:00:00Z"),
  decidedByUserId: "owner",
  decisionAction: "APPROVED",
  decisionReason: null,
  directCost: "100.0000",
  discountRate: "1.0000",
  expectedCost: "70.0000",
  grossMarginRate: "0.5333",
  grossProfit: "80.0000",
  id: "quotation",
  isCurrent: true,
  mainMaterialCatalogVersionId: "catalog",
  mainMaterialDirectCost: "50.0000",
  mainMaterialExpectedCost: "40.0000",
  mainMaterialManagementFee: "5.0000",
  mainMaterialTotal: "55.0000",
  managementFee: "10.0000",
  managementRate: "0.1000",
  marginBenchmarkRate: "0.3000",
  outerFrameArea: "130.0000",
  parentVersionId: null,
  projectAddress: "上海市长宁区示例项目",
  projectId: "project",
  revision: 3,
  ruleVersionId: "rule",
  scopes: [],
  status: "APPROVED",
  submittedAt: new Date("2026-09-08T00:00:00Z"),
  submittedByUserId: "lead",
  templateVersionId: "template",
  templateVersionNumber: 5,
  total: "110.0000",
  versionNumber: 2,
  writeOff: "15.0000",
};

const mainMaterial: MainMaterialQuotation = {
  catalog: { id: "catalog", name: "山屿 ERP 主材库 V1", versionNumber: 1 },
  directCost: "50.0000",
  expectedCost: "40.0000",
  id: quotation.id,
  lines: [
    {
      assetIds: [], baseQuantity: "10.0000", brand: "HBI", categoryCode: "TILE",
      colors: [], costAmount: "800.0000", costUnitPrice: "80.00", demandName: "客厅地砖",
      demandSpec: "750*1500", id: "line-1", itemName: "瓷砖", itemVersionId: "item-1",
      lossRate: "0.1500", materialId: "MAT-TILE-1", model: "TI0T", origin: "AUTO_TILE",
      quantity: "10.0000", saleAmount: "1000.0000", saleUnitPrice: "100.00", scopeName: "客厅",
      selectedColor: null, series: "凹凸面", spec: "750*1500", unit: "M2",
    },
    {
      assetIds: [], baseQuantity: null, brand: "", categoryCode: "SEAM", colors: [],
      costAmount: "0.0000", costUnitPrice: "10.00", demandName: "不应导出", demandSpec: "",
      id: "line-2", itemName: "不应导出", itemVersionId: "item-2", lossRate: "0.0000",
      materialId: "MAT-SEAM-1", model: "", origin: "MANUAL", quantity: "0.0000",
      saleAmount: "0.0000", saleUnitPrice: "20.00", scopeName: "项目级", selectedColor: null,
      series: "", spec: "", unit: "M2",
    },
  ],
  managementFee: "5.0000",
  projectId: quotation.projectId,
  revision: quotation.revision,
  status: "APPROVED",
  total: "55.0000",
};
