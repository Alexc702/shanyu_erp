import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapFullImportItem, normalizeMaterialVariant } from "../src/main-material/main-material-import-mapping";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";

const baseline = JSON.parse(readFileSync(resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8")) as {
  items: (NormalizedMainMaterialItem & { assetIds: string[] })[];
};
const door = baseline.items.find((i) => i.materialId === "MAT-GLASS_DOOR-4CED024ABA98")!;

describe("full import selection and record versions", () => {
  it("0920 derives 34A types from the current source without changing legacy data", () => {
    const previous = baseline.items.find((item) => item.materialId === "MAT-SHOWER-DC6F85FFDF14")!;
    const source = { ...previous, attributes: { ...previous.attributes, type: "钻石型；T型；一固一开" } };
    for (const result of [mapFullImportItem(source, previous), normalizeMaterialVariant(source, previous)]) {
      expect(JSON.parse(result.attributes.showerTypes!)).toEqual(["钻石型", "T型", "一固一开"]);
      expect(result.salePrice).toBe(previous.salePrice);
      expect(result.colors).toEqual(previous.colors);
    }
    expect(previous.attributes.showerTypes).toBeUndefined();
  });
  it("preserves glass/frame maps by material_id and advances a stale record version", () => {
    const raw = { ...door, recordVersion: 1, attributes: { imageReference: door.attributes.imageReference! } };
    const result = mapFullImportItem(raw, door);
    expect(result.recordVersion).toBe(door.recordVersion + 1);
    for (const key of ["colorAssetMap", "glassColorAssetMap", "glassColors"]) {
      expect(result.attributes[key]).toBe(door.attributes[key]);
    }
    expect(door.recordVersion).toBe(5);
  });

  it("rebuilds Gulang grouping and colour fields without altering prices", () => {
    const previous = baseline.items.find((i) => i.brand === "顾朗")!;
    const result = mapFullImportItem({ ...previous, attributes: { imageReference: previous.attributes.imageReference! } }, previous);
    expect(result.attributes.variantGroup).toBe(`顾朗:${previous.model}`);
    expect(result.attributes.variantColor).toBe(previous.colors[0]);
    expect(result.salePrice).toBe(previous.salePrice);
    expect(result.costPrice).toBe(previous.costPrice);
  });

  it("rejects changed image references and missing mapped assets", () => {
    expect(() => mapFullImportItem({ ...door, attributes: { imageReference: "other.png" } }, door)).toThrow("产品图引用已变化");
    expect(() => mapFullImportItem(door, { ...door, assetIds: [door.assetIds[0]!] })).toThrow("缺少有效色卡资产关联");
  });

  it("removes deleted colours from maps rather than reviving obsolete selections", () => {
    const result = mapFullImportItem({ ...door, colors: [door.colors[0]!] }, door);
    expect(Object.keys(JSON.parse(result.attributes.colorAssetMap!))).toEqual([door.colors[0]]);
  });

  it("rejects unregistered product images and category changes with inherited assets", () => {
    expect(() => mapFullImportItem({ ...door, materialId: "MAT-NEW" })).toThrow("产品图缺少已登记资产");
    expect(() => mapFullImportItem({ ...door, categoryCode: "CUSTOM" }, door)).toThrow("分类变化");
  });

  it.each(["顾朗:", "定制浴室柜:"])("does not reuse the old colour image when a %s variant is renamed", (group) => {
    const previous = baseline.items.find((i) => i.attributes.variantGroup?.startsWith(group) && i.assetIds.length)!;
    expect(() => mapFullImportItem({ ...previous, colors: ["未核对的新颜色"] }, previous)).toThrow("颜色变体变化需先核对产品图片");
  });

  it("keeps record versions monotonic by material_id even when an asset-free item changes category", () => {
    const previous = { ...door, assetIds: [], recordVersion: 9 };
    const result = mapFullImportItem({ ...door, categoryCode: "CUSTOM", attributes: {}, colors: [], recordVersion: 1 }, previous);
    expect(result.recordVersion).toBe(10);
  });
});
