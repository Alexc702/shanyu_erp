export interface ModuleAdjustment {
  readonly discountRate: string;
  readonly writeOff: string;
}

interface ProjectPricingInput extends ModuleAdjustment {
  readonly total: string;
  readonly mainMaterialTotal?: string;
  readonly mainMaterialAdjustment?: ModuleAdjustment | null;
  readonly designFeeUnitPrice?: string | null;
  readonly outerFrameArea: string;
}

/** Legacy snapshots retain global adjustments; explicit module adjustments opt in. */
export function calculateProjectPricing(input: ProjectPricingInput) {
  const half = units(input.total);
  const material = units(input.mainMaterialTotal ?? "0");
  const design = input.designFeeUnitPrice == null ? null
    : ((units(input.designFeeUnitPrice) * units(input.outerFrameArea) + 500_000n) / 1_000_000n) * 100n;
  const adjustedHalf = adjusted(half, input);
  const adjustedMaterial = input.mainMaterialAdjustment
    ? adjusted(material, input.mainMaterialAdjustment)
    : adjusted(half + material, input) - adjustedHalf;
  return {
    halfPackageAdjustedTotal: fixed(adjustedHalf),
    mainMaterialAdjustedTotal: fixed(adjustedMaterial),
    designFeeAmount: design === null ? null : fixed(design),
    total: fixed(half + material + (design ?? 0n)),
    adjustedTotal: fixed(adjustedHalf + adjustedMaterial + (design ?? 0n)),
  };
}

export function hasExcessiveModuleWriteOff(input: ProjectPricingInput): boolean {
  return Boolean(input.mainMaterialAdjustment && (
    units(input.writeOff) > (units(input.total) * units(input.discountRate) + 5000n) / 10000n ||
    units(input.mainMaterialAdjustment.writeOff) > (units(input.mainMaterialTotal ?? "0") * units(input.mainMaterialAdjustment.discountRate) + 5000n) / 10000n
  ));
}

function adjusted(amount: bigint, adjustment: ModuleAdjustment): bigint {
  const value = (amount * units(adjustment.discountRate) + 5000n) / 10000n - units(adjustment.writeOff);
  return value > 0n ? value : 0n;
}

function units(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match?.[1]) throw new Error("金额必须为非负数且最多四位小数");
  return BigInt(match[1]) * 10000n + BigInt((match[2] ?? "").padEnd(4, "0"));
}

function fixed(value: bigint): string {
  return `${value / 10000n}.${(value % 10000n).toString().padStart(4, "0")}`;
}
