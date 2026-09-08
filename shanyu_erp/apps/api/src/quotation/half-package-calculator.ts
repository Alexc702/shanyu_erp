export type QuantityRule =
  | { readonly kind: "MANUAL" }
  | { readonly kind: "PROJECT_OUTER_FRAME_AREA" }
  | { readonly kind: "SPACE_AREA" }
  | { readonly kind: "SPACE_PERIMETER_HEIGHT" }
  | {
      readonly kind: "LINE_REFERENCE";
      readonly referencedLineId: string;
    };

export interface QuotationCalculationLineInput {
  readonly costUnitPrice: string;
  readonly id: string;
  readonly manualQuantity: string | null;
  readonly quantityRule: QuantityRule;
  readonly saleUnitPrice: string;
  readonly selected: boolean;
}

export interface QuotationCalculationScopeInput {
  readonly area: string | null;
  readonly height: string | null;
  readonly id: string;
  readonly lines: readonly QuotationCalculationLineInput[];
  readonly perimeter: string | null;
}

export interface QuotationCalculationInput {
  readonly discountRate: string;
  readonly managementRate: string;
  readonly outerFrameArea: string;
  readonly scopes: readonly QuotationCalculationScopeInput[];
  readonly writeOff: string;
}

export interface QuotationCalculationLineResult {
  readonly amount: string | null;
  readonly costAmount: string | null;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string | null;
  readonly id: string;
  readonly quantity: string | null;
}

export interface QuotationCalculationScopeResult {
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly id: string;
  readonly lines: readonly QuotationCalculationLineResult[];
  readonly subtotal: string;
}

export interface QuotationCalculationResult {
  readonly adjustedTotal: string;
  readonly directCost: string;
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly managementFee: string;
  readonly scopes: readonly QuotationCalculationScopeResult[];
  readonly total: string;
}

const scale = 10_000n;

export class HalfPackageCalculator {
  calculate(input: QuotationCalculationInput): QuotationCalculationResult {
    const outerFrameArea = parseDecimal4(input.outerFrameArea);
    const scopes = input.scopes.map((scope) =>
      this.calculateScope(scope, outerFrameArea),
    );
    const directCost = scopes.reduce(
      (sum, scope) => sum + parseDecimal4(scope.subtotal),
      0n,
    );
    const expectedCost = scopes.reduce(
      (sum, scope) => sum + parseDecimal4(scope.expectedCost),
      0n,
    );
    const managementFee = multiply4(
      directCost,
      parseDecimal4(input.managementRate),
    );
    const total = directCost + managementFee;
    const adjustedTotal = maximum(
      multiply4(total, parseDecimal4(input.discountRate)) -
        parseDecimal4(input.writeOff),
      0n,
    );
    const grossProfit = adjustedTotal - expectedCost;

    return {
      adjustedTotal: formatDecimal4(adjustedTotal),
      directCost: formatDecimal4(directCost),
      expectedCost: formatDecimal4(expectedCost),
      grossMarginRate:
        adjustedTotal === 0n
          ? null
          : formatDecimal4(divide4(grossProfit, adjustedTotal)),
      grossProfit: formatDecimal4(grossProfit),
      managementFee: formatDecimal4(managementFee),
      scopes,
      total: formatDecimal4(total),
    };
  }

  private calculateScope(
    scope: QuotationCalculationScopeInput,
    outerFrameArea: bigint,
  ): QuotationCalculationScopeResult {
    const linesById = new Map(
      scope.lines.map((line) => [line.id, line] as const),
    );
    if (linesById.size !== scope.lines.length) {
      throw new Error("同一报价范围内的行项目 ID 必须唯一");
    }
    const quantities = new Map<string, bigint | null>();
    const resolving = new Set<string>();

    const resolveQuantity = (lineId: string): bigint | null => {
      if (quantities.has(lineId)) {
        return quantities.get(lineId) ?? null;
      }
      const line = linesById.get(lineId);
      if (!line) {
        throw new Error("自动数量引用的工程项不存在");
      }
      if (!line.selected) {
        quantities.set(lineId, null);
        return null;
      }
      if (resolving.has(lineId)) {
        throw new Error("自动数量规则不能循环引用");
      }
      resolving.add(lineId);
      const quantity = quantityForRule(
        line,
        scope,
        outerFrameArea,
        resolveQuantity,
      );
      resolving.delete(lineId);
      quantities.set(lineId, quantity);
      return quantity;
    };

    let subtotal = 0n;
    let expectedCost = 0n;
    const lines = scope.lines.map((line) => {
      const quantity = resolveQuantity(line.id);
      const amount =
        quantity === null
          ? null
          : multiply4(quantity, parseDecimal4(line.saleUnitPrice));
      const costAmount =
        quantity === null
          ? null
          : multiply4(quantity, parseDecimal4(line.costUnitPrice));
      if (amount !== null) {
        subtotal += amount;
      }
      if (costAmount !== null) {
        expectedCost += costAmount;
      }
      const grossProfit =
        amount === null || costAmount === null ? null : amount - costAmount;
      return {
        amount: amount === null || amount === 0n ? null : formatDecimal4(amount),
        costAmount:
          costAmount === null || costAmount === 0n
            ? null
            : formatDecimal4(costAmount),
        grossMarginRate:
          grossProfit === null || amount === null || amount === 0n
            ? null
            : formatDecimal4(divide4(grossProfit, amount)),
        grossProfit:
          grossProfit === null ? null : formatDecimal4(grossProfit),
        id: line.id,
        quantity: quantity === null ? null : formatDecimal4(quantity),
      };
    });

    const grossProfit = subtotal - expectedCost;
    return {
      expectedCost: formatDecimal4(expectedCost),
      grossMarginRate:
        subtotal === 0n
          ? null
          : formatDecimal4(divide4(grossProfit, subtotal)),
      grossProfit: formatDecimal4(grossProfit),
      id: scope.id,
      lines,
      subtotal: formatDecimal4(subtotal),
    };
  }
}

function quantityForRule(
  line: QuotationCalculationLineInput,
  scope: QuotationCalculationScopeInput,
  outerFrameArea: bigint,
  resolveQuantity: (lineId: string) => bigint | null,
): bigint | null {
  switch (line.quantityRule.kind) {
    case "MANUAL":
      return line.manualQuantity === null
        ? null
        : parseDecimal4(line.manualQuantity);
    case "PROJECT_OUTER_FRAME_AREA":
      return outerFrameArea;
    case "SPACE_AREA":
      return optionalDecimal4(scope.area);
    case "SPACE_PERIMETER_HEIGHT": {
      const perimeter = optionalDecimal4(scope.perimeter);
      const height = optionalDecimal4(scope.height);
      return perimeter === null || height === null
        ? null
        : multiply4(perimeter, height);
    }
    case "LINE_REFERENCE":
      return resolveQuantity(line.quantityRule.referencedLineId);
  }
}

function optionalDecimal4(value: string | null): bigint | null {
  return value === null ? null : parseDecimal4(value);
}

function parseDecimal4(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match?.[1]) {
    throw new Error(`数值必须是最多四位小数：${value}`);
  }
  const fraction = (match[2] ?? "").padEnd(4, "0");
  return BigInt(match[1]) * scale + BigInt(fraction);
}

function multiply4(left: bigint, right: bigint): bigint {
  return (left * right + scale / 2n) / scale;
}

function formatDecimal4(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function divide4(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("毛利率分母必须大于 0");
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = (absolute * scale + denominator / 2n) / denominator;
  return negative ? -quotient : quotient;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
