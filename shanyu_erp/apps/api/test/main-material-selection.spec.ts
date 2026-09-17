import { describe, expect, it } from "vitest";

import { isMainMaterialColorSelectionValid } from "../src/main-material/main-material-selection";

describe("main material colour selection", () => {
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
