import type { HalfPackageCostMarginScope } from "@shanyu/contracts";

const commonScopeOrder = new Map([
  ["一、砌墙工程", 0],
  ["十、油漆工程", 70],
  ["十一、水电工程", 80],
  ["十二、其他工程", 90],
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
  grossProfit: string,
): "未计价" | "已计算" | "负毛利" {
  if (salesAmount === "0.0000") {
    return "未计价";
  }
  return grossProfit.startsWith("-") ? "负毛利" : "已计算";
}

export function orderCostMarginScopes(
  scopes: readonly HalfPackageCostMarginScope[],
): HalfPackageCostMarginScope[] {
  return scopes
    .map((scope, index) => ({ index, scope }))
    .sort((left, right) => {
      const orderDifference = scopeOrder(left.scope) - scopeOrder(right.scope);
      return orderDifference === 0
        ? left.index - right.index
        : orderDifference;
    })
    .map(({ scope }) => scope);
}

function scopeOrder(scope: HalfPackageCostMarginScope): number {
  return scope.spaceType
    ? spaceTypeOrder[scope.spaceType]
    : (commonScopeOrder.get(scope.name) ?? 60);
}
