import { describe, expect, it } from "vitest";

import { isMainMaterialColorSelectionValid, isMainMaterialTileSpecCompatible } from "../src/main-material/main-material-selection";

describe("castle tile demand compatibility", () => {
  it("matches castle products and the legacy generic-name combined size without accepting other tiles", () => {
    const demand = "多规格古堡砖（水泥砂浆粘贴）";
    const spec = "200*200/200*400/400*400/400*600";
    expect(isMainMaterialTileSpecCompatible(demand, "多规格", { itemName: "古堡砖", spec })).toBe(true);
    expect(isMainMaterialTileSpecCompatible(demand, "多规格", { itemName: "瓷砖", spec })).toBe(true);
    expect(isMainMaterialTileSpecCompatible(demand, "多规格", { itemName: "瓷砖", spec: "800*800" })).toBe(false);
    expect(isMainMaterialTileSpecCompatible(demand, "多规格", { itemName: "其他砖", spec: "多规格" })).toBe(false);
    expect(isMainMaterialTileSpecCompatible("800mm地砖", "800×800mm", { itemName: "瓷砖", spec: "800*800" })).toBe(true);
    expect(isMainMaterialTileSpecCompatible("800mm地砖", "800*800", { itemName: "古堡砖", spec })).toBe(false);
    expect(isMainMaterialTileSpecCompatible("其他多规格需求", "多规格", { itemName: "古堡砖", spec })).toBe(false);
  });
});

describe("main material colour selection", () => {
  it("accepts fixed 34A types on old catalogs, requiring a type only on explicit selection", () => {
    const item = { materialId: "MAT-SHOWER-DC6F85FFDF14", brand: "朗格",
      categoryCode: "SHOWER", colors: ["枪灰拉丝"], attributes: {} };
    for (const type of ["钻石型", "T型", "一固一开"]) {
      expect(isMainMaterialColorSelectionValid(item, `类型：${type}｜颜色：枪灰拉丝`, true)).toBe(true);
    }
    for (const value of [null, "枪灰拉丝", "类型：弧形｜颜色：枪灰拉丝", "类型：T型｜颜色：不存在"]) {
      expect(isMainMaterialColorSelectionValid(item, value, true)).toBe(false);
    }
    expect(isMainMaterialColorSelectionValid(item, "枪灰拉丝")).toBe(true);
    for (const other of [{ ...item, materialId: "other" }, { ...item, brand: "other" }]) {
      expect(isMainMaterialColorSelectionValid(other, "枪灰拉丝", true)).toBe(true);
      expect(isMainMaterialColorSelectionValid(other, "类型：T型｜颜色：枪灰拉丝", true)).toBe(false);
    }
  });
  it("0920 requires both an approved shower type and colour without changing legacy selections", () => {
    const item = { categoryCode: "SHOWER", colors: ["亮银", "黑色"],
      attributes: { showerTypes: JSON.stringify(["钻石型", "T型", "一固一开"]) } };
    expect(isMainMaterialColorSelectionValid(item, "类型：T型｜颜色：亮银")).toBe(true);
    for (const value of [null, "亮银", "类型：弧形｜颜色：亮银", "类型：T型｜颜色：白色"]) {
      expect(isMainMaterialColorSelectionValid(item, value)).toBe(false);
    }
    expect(isMainMaterialColorSelectionValid({ ...item, attributes: {} }, "亮银")).toBe(true);
  });
  it("validates the two-stage glass-door selection", () => {
    const item = {
      attributes: { glassColors: JSON.stringify(["8MM 超白玻", "8mm欧洲灰"]) },
      categoryCode: "GLASS_DOOR",
      colors: ["瓷泳黑", "瓷泳灰"],
    } as const;

    expect(isMainMaterialColorSelectionValid(
      item,
      "门框：瓷泳黑｜玻璃：8MM 超白玻",
    )).toBe(true);
    expect(isMainMaterialColorSelectionValid(item, "瓷泳黑")).toBe(false);
    expect(isMainMaterialColorSelectionValid(
      item,
      "门框：拉丝灰｜玻璃：8MM 超白玻",
    )).toBe(false);
    expect(isMainMaterialColorSelectionValid(
      item,
      "门框：瓷泳黑｜玻璃：茶色玻璃",
    )).toBe(false);
  });

  it("supports glass-only products and preserves ordinary colour validation", () => {
    expect(isMainMaterialColorSelectionValid({
      attributes: { glassColors: JSON.stringify(["8MM 超白玻"]) },
      categoryCode: "GLASS_DOOR",
      colors: [],
    }, "玻璃：8MM 超白玻")).toBe(true);
    expect(isMainMaterialColorSelectionValid({
      attributes: {},
      categoryCode: "FLOOR",
      colors: ["原木色"],
    }, "原木色")).toBe(true);
  });

  it("supports a frame-only glass-door item without accepting a glass choice", () => {
    const item = {
      attributes: {},
      categoryCode: "GLASS_DOOR",
      colors: ["瓷泳黑", "瓷泳灰"],
    } as const;

    expect(isMainMaterialColorSelectionValid(item, "瓷泳黑")).toBe(true);
    expect(isMainMaterialColorSelectionValid(item, "玻璃：8MM 超白玻")).toBe(false);
    expect(isMainMaterialColorSelectionValid(
      item,
      "门框：瓷泳黑｜玻璃：8MM 超白玻",
    )).toBe(false);
  });
});
