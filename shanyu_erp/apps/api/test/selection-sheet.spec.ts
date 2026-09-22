import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { selectionSheetImages } from "../src/quotation/selection-sheet-images";
import { buildSelectionSheetRows, renderSelectionSheet } from "../src/quotation/selection-sheet";
import type { MainMaterialItem, MainMaterialQuotation, MainMaterialRepository } from "../src/main-material/main-material.repository";

const item = { id: "version-item", materialId: "stable", catalogVersionId: "bound", recordVersion: 2,
  categoryName: "淋浴房", categoryCode: "SHOWER", itemName: "淋浴房", attributes: {}, colors: ["亮银"], assetIds: ["photo"],
} as unknown as MainMaterialItem;
const quotation = { catalog: { id: "bound" }, lines: [{ itemVersionId: "version-item", materialId: "stable", quantity: "1.0000", selectedColor: "亮银", itemName: "淋浴房", brand: "朗格", scopeName: "主卫", spec: "定制", assetIds: [], costUnitPrice: "秘密成本", saleAmount: "秘密售价" }] } as unknown as MainMaterialQuotation;
const repository = { findItem: async () => item } as unknown as MainMaterialRepository;
const readImage = async () => sharp({ create: { width: 40, height: 60, channels: 3, background: "#aabbcc" } }).png().toBuffer();
describe("0920 customer selection sheet", () => {
  it("uses bound IDs and a strict output whitelist without price or source fields", async () => {
    const rows = await buildSelectionSheetRows(quotation, repository);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!)).toEqual(["category", "name", "brand", "color", "spec", "description", "locations", "images"]);
    expect(JSON.stringify(rows)).not.toMatch(/秘密|version-item|stable|bound/);
  });
  it("blocks missing colors and mismatched version associations", async () => {
    await expect(buildSelectionSheetRows({ ...quotation, lines: [{ ...quotation.lines[0]!, selectedColor: null }] }, repository)).rejects.toThrow("尚未完成颜色选择");
    await expect(buildSelectionSheetRows(quotation, { findItem: async () => ({ ...item, catalogVersionId: "latest-not-bound" }) } as unknown as MainMaterialRepository)).rejects.toThrow("版本关联异常");
  });
  it("merges identical selections but preserves distinct colors and locations", async () => {
    const rows = await buildSelectionSheetRows({ ...quotation, lines: [...quotation.lines, { ...quotation.lines[0]!, scopeName: "公卫" }] }, repository);
    expect(rows).toHaveLength(1); expect(rows[0]?.locations).toEqual(["主卫", "公卫"]);
  });
  it("does not emit an empty confirmation document", async () => {
    await expect(buildSelectionSheetRows({ ...quotation, lines: [] }, repository)).rejects.toThrow("不能生成空选材单");
  });
  it("rejects assets that do not belong to the frozen item", async () => {
    await expect(buildSelectionSheetRows({ ...quotation, lines: [{ ...quotation.lines[0]!, assetIds: ["foreign"] }] }, { findItem: async () => ({ ...item, assetIds: [] }) } as unknown as MainMaterialRepository)).rejects.toThrow("图片关联");
  });
  it("removes contact information from customer fields without changing snapshots", async () => {
    const before = JSON.stringify(quotation);
    const rows = await buildSelectionSheetRows({ ...quotation, lines: [{ ...quotation.lines[0]!, spec: "304不锈钢 https://internal.example/price 联系13812345678 a@example.com" }] }, repository);
    expect(rows[0]?.spec).toBe("304不锈钢  联系");
    expect(JSON.stringify(quotation)).toBe(before);
  });
  it("renders a searchable portrait PDF with a confirmation page and no financial metadata", async () => {
    const rows = await buildSelectionSheetRows(quotation, repository);
    const file = await renderSelectionSheet({ templateVersion: "0922-v2", project: "隔离验收项目", customer: "测试客户", designer: "测试主案", version: 2, date: "2026/9/21", rows }, readImage);
    const pdf = await PDFDocument.load(file.payload);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("项目选材单"); expect(pdf.getSubject()).toBeUndefined();
    expect(pdf.getPages().every(page => page.getHeight() > page.getWidth())).toBe(true);
  });
  it("paginates long descriptions and multiple categories without mutating the snapshot", async () => {
    const rows = await buildSelectionSheetRows(quotation, repository);
    const snapshot = { templateVersion: "0922-v2" as const, project: "分页验收", customer: "测试", designer: "测试", version: 1, date: "2026/9/21",
      rows: Array.from({ length: 40 }, (_, index) => ({ ...rows[0]!, category: index < 20 ? "淋浴房" : "卫浴", name: `材料${index + 1}`, description: "规格说明及使用注意事项。".repeat(index === 0 ? 150 : 8) })) };
    const before = JSON.stringify(snapshot);
    const file = await renderSelectionSheet(snapshot, readImage);
    const pdf = await PDFDocument.load(file.payload);
    expect(pdf.getPageCount()).toBeGreaterThan(5);
    expect(pdf.getPageCount()).toBeLessThan(40);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("moves confirmation to a separate page when cover fields need more space", async () => {
    const rows = await buildSelectionSheetRows(quotation, repository);
    const snapshot = { templateVersion: "0922-v2" as const, project: "浙江省嘉兴市项目地址与楼栋房间说明".repeat(10), customer: "测试客户", designer: "测试主案", version: 1, date: "2026/9/21", rows };
    const before = JSON.stringify(snapshot);
    const file = await renderSelectionSheet(snapshot, readImage);
    const pdf = await PDFDocument.load(file.payload);
    expect(pdf.getPageCount()).toBe(3);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("blocks missing images instead of silently using a placeholder", async () => {
    expect(() => selectionSheetImages({ ...item, assetIds: [] }, "亮银")).toThrow("缺少对应图片");
    const rows = await buildSelectionSheetRows(quotation, repository);
    await expect(renderSelectionSheet({ templateVersion: "0922-v2", project: "测试", customer: "", designer: "", version: 1, date: "", rows }, async () => { throw new Error("missing"); })).rejects.toThrow("图片缺失或校验失败");
  });
  it("selects exact frame and glass swatches, with no product image for casing", () => {
    const glass: MainMaterialItem = { ...item, categoryCode: "GLASS_DOOR", assetIds: ["photo", "frame", "glass"], attributes: { colorAssetMap: JSON.stringify({ 亮银: "frame" }), glassColorAssetMap: JSON.stringify({ 超白: "glass" }) } };
    expect(selectionSheetImages(glass, "门框：亮银｜玻璃：超白").map(image => image.assetId)).toEqual(["photo", "frame", "glass"]);
    expect(selectionSheetImages({ ...glass, materialId: "MAT-GLASS_DOOR-FBACE026D73F" }, "亮银")).toEqual([{ assetId: "frame", role: "color", label: "门框：亮银" }]);
    expect(() => selectionSheetImages(glass, "门框：雅黑｜玻璃：超白")).toThrow("缺少对应图片");
  });
  it("uses the cabinet variant texture and refuses another selected color", () => {
    const cabinet = { ...item, attributes: { variantGroup: "定制浴室柜:免漆公卫", variantColor: "熊猫白" } };
    expect(selectionSheetImages(cabinet, "熊猫白")).toEqual([{ assetId: "photo", role: "color", label: "熊猫白" }]);
    expect(() => selectionSheetImages(cabinet, "烟粉")).toThrow("缺少对应图片");
  });
  it("normalizes Lange mirror labels without guessing another swatch", () => {
    const shower = { ...item, brand: "朗格", assetIds: ["photo", "silver"], attributes: { colorAssetMap: JSON.stringify({ "镜光（镜面）": "silver" }) } };
    expect(selectionSheetImages(shower, "类型：开门｜颜色：镜光(镜面)")[1]?.assetId).toBe("silver");
  });
});
