import type { HalfPackageCostMarginScope } from "@shanyu/contracts";

const commonScopeOrder = new Map([
  ["一、砌墙工程", 0],
  ["十、油漆工程", 70],
  ["十一、水电工程", 80],
  ["十二、其他工程", 90],
  ["管理费", 100],
]);

const spaceTypeOrder: Record<
  NonNullable<HalfPackageCostMarginScope["spaceType"]>,
  number
> = {
  BALCONY: 50,
  BATHROOM: 30,
  BEDROOM: 20,
  CLOSET: 25,
  KITCHEN: 40,
  LIVING_DINING: 10,
};

export function formatMarginRate(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const match = /^(-?)(\d+)\.(\d{4})$/.exec(value);
  if (!match?.[2] || !match[3]) {
    throw new Error(`服务端毛利率格式无效：${value}`);
  }
  const hundred = BigInt(100);
  const scaled = BigInt(match[2]) * BigInt(10_000) + BigInt(match[3]);
  return `${match[1]}${scaled / hundred}.${(scaled % hundred)
    .toString()
    .padStart(2, "0")}%`;
}

export function marginStatus(
  salesAmount: string,
  grossMarginRate: string | null,
  marginBenchmarkRate: string,
): "未计价" | "正常" | "低于基准" | "负毛利" {
  if (salesAmount === "0.0000") {
    return "未计价";
  }
  if (grossMarginRate === null) {
    return "未计价";
  }
  if (grossMarginRate.startsWith("-")) {
    return "负毛利";
  }
  return Number(grossMarginRate) < Number(marginBenchmarkRate)
    ? "低于基准"
    : "正常";
}

export function orderCostMarginScopes(
  scopes: readonly HalfPackageCostMarginScope[],
): HalfPackageCostMarginScope[] {
  return scopes
    .map((scope, index) => ({ index, scope }))
    .sort((left, right) => {
      const orderDifference = scopeOrder(left.scope) - scopeOrder(right.scope);
      if (orderDifference !== 0) return orderDifference;
      const nameDifference =
        scopeNameOrder(left.scope) - scopeNameOrder(right.scope);
      return nameDifference === 0 ? left.index - right.index : nameDifference;
    })
    .map(({ scope }) => scope);
}

function scopeNameOrder(scope: HalfPackageCostMarginScope): number {
  if (scope.spaceType === "BEDROOM") {
    if (/^主卧/.test(scope.name)) return 0;
    if (/^次卧/.test(scope.name)) return 10;
  }
  if (scope.spaceType === "BATHROOM") {
    if (/^主(?:卫|卫生间)/.test(scope.name)) return 0;
    if (/^次(?:卫|卫生间)/.test(scope.name)) return 10;
  }
  return 20;
}

function scopeOrder(scope: HalfPackageCostMarginScope): number {
  return scope.spaceType
    ? spaceTypeOrder[scope.spaceType]
    : (commonScopeOrder.get(scope.name) ?? 60);
}
