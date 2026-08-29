import type { HalfPackageCostMarginScope } from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import {
  formatMarginRate,
  marginStatus,
  orderCostMarginScopes,
} from "./cost-margin-view-model";

describe("cost margin view model", () => {
  it("formats positive, zero, negative, and blank four-decimal rates", () => {
    expect(formatMarginRate("0.2880")).toBe("28.80%");
    expect(formatMarginRate("0.0000")).toBe("0.00%");
    expect(formatMarginRate("-0.3449")).toBe("-34.49%");
    expect(formatMarginRate(null)).toBe("—");
  });

  it("uses only objective calculation states without an invented warning threshold", () => {
    expect(marginStatus("0.0000", "0.0000")).toBe("未计价");
    expect(marginStatus("100.0000", "20.0000")).toBe("已计算");
    expect(marginStatus("100.0000", "-1.0000")).toBe("负毛利");
  });

  it("orders every common range and project space for the detail navigation", () => {
    const scopes = [
      scope("十二、其他工程", null),
      scope("主卫", "BATHROOM"),
      scope("客餐厅", "LIVING_DINING"),
      scope("一、砌墙工程", null),
      scope("主卧", "BEDROOM"),
      scope("十一、水电工程", null),
      scope("十、油漆工程", null),
    ];
    expect(orderCostMarginScopes(scopes).map(({ name }) => name)).toEqual([
      "一、砌墙工程",
      "客餐厅",
      "主卧",
      "主卫",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
    ]);
  });
});

function scope(
  name: string,
  spaceType: HalfPackageCostMarginScope["spaceType"],
): HalfPackageCostMarginScope {
  return {
    expectedCost: "0.0000",
    grossMarginRate: null,
    grossProfit: "0.0000",
    id: name,
    lines: [],
    name,
    salesAmount: "0.0000",
    spaceType,
  };
}
