import { describe, expect, it } from "vitest";

import { moveSpace } from "./space-order";

describe("moveSpace", () => {
  it("swaps only adjacent spaces", () => {
    expect(moveSpace(["客餐厅", "主卧", "次卧"], 1, -1)).toEqual([
      "主卧",
      "客餐厅",
      "次卧",
    ]);
    expect(moveSpace(["客餐厅", "主卧", "次卧"], 1, 1)).toEqual([
      "客餐厅",
      "次卧",
      "主卧",
    ]);
  });

  it("keeps the order at the first and last boundaries", () => {
    expect(moveSpace(["客餐厅", "主卧"], 0, -1)).toEqual(["客餐厅", "主卧"]);
    expect(moveSpace(["客餐厅", "主卧"], 1, 1)).toEqual(["客餐厅", "主卧"]);
  });
});
