import { describe, expect, it } from "vitest";

import { calculateProjectPricing, hasExcessiveModuleWriteOff } from "../src/quotation/project-pricing";

describe("0920 project module pricing", () => {
  const base = { total: "100000.0000", mainMaterialTotal: "60000.0000", outerFrameArea: "130.0000", discountRate: "0.9500", writeOff: "0.0000" };
  it("preserves legacy global adjustments unless module pricing is explicitly supplied", () => {
    expect(calculateProjectPricing(base).adjustedTotal).toBe("152000.0000");
  });
  it("discounts modules separately, then adds the design fee without discounting twice", () => {
    expect(calculateProjectPricing({ ...base, mainMaterialAdjustment: { discountRate: "0.9800", writeOff: "300.0000" }, designFeeUnitPrice: "50.0000" })).toEqual({
      halfPackageAdjustedTotal: "95000.0000", mainMaterialAdjustedTotal: "58500.0000", designFeeAmount: "6500.0000", total: "166500.0000", adjustedTotal: "160000.0000",
    });
  });
  it("keeps unset distinct from explicit zero and rounds design fees to cents", () => {
    expect(calculateProjectPricing(base).designFeeAmount).toBeNull();
    expect(calculateProjectPricing({ ...base, designFeeUnitPrice: "0" }).designFeeAmount).toBe("0.0000");
    expect(calculateProjectPricing({ ...base, outerFrameArea: "1.2345", designFeeUnitPrice: "10" }).designFeeAmount).toBe("12.3500");
  });
  it("does not allow write-offs in one module to consume another module or design fee", () => {
    expect(hasExcessiveModuleWriteOff({ ...base, writeOff: "999999", mainMaterialAdjustment: { discountRate: "1", writeOff: "0" } })).toBe(true);
  });
});
