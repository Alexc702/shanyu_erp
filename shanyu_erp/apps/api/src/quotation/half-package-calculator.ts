export type QuantityRule =
  | { readonly kind: "MANUAL" }
  | { readonly kind: "PROJECT_BUILDING_AREA" }
  | { readonly kind: "SPACE_AREA" }
  | { readonly kind: "SPACE_PERIMETER_HEIGHT" }
  | {
      readonly kind: "LINE_REFERENCE";
      readonly referencedLineId: string;
    };

export interface QuotationCalculationLineInput {
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
  readonly buildingArea: string;
  readonly managementRate: string;
  readonly scopes: readonly QuotationCalculationScopeInput[];
}

export interface QuotationCalculationLineResult {
  readonly amount: string | null;
  readonly id: string;
  readonly quantity: string | null;
}

export interface QuotationCalculationScopeResult {
  readonly id: string;
  readonly lines: readonly QuotationCalculationLineResult[];
  readonly subtotal: string;
}

export interface QuotationCalculationResult {
  readonly directCost: string;
  readonly managementFee: string;
  readonly scopes: readonly QuotationCalculationScopeResult[];
  readonly total: string;
}

const scale = 10_000n;

export class HalfPackageCalculator {
  calculate(input: QuotationCalculationInput): QuotationCalculationResult {
    const buildingArea = parseDecimal4(input.buildingArea);
    const scopes = input.scopes.map((scope) =>
      this.calculateScope(scope, buildingArea),
    );
    const directCost = scopes.reduce(
      (sum, scope) => sum + parseDecimal4(scope.subtotal),
      0n,
    );
    const managementFee = multiply4(
      directCost,
      parseDecimal4(input.managementRate),
    );

    return {
      directCost: formatDecimal4(directCost),
      managementFee: formatDecimal4(managementFee),
      scopes,
      total: formatDecimal4(directCost + managementFee),
    };
  }

  private calculateScope(
    scope: QuotationCalculationScopeInput,
    buildingArea: bigint,
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
        buildingArea,
        resolveQuantity,
      );
      resolving.delete(lineId);
      quantities.set(lineId, quantity);
      return quantity;
    };

    let subtotal = 0n;
    const lines = scope.lines.map((line) => {
      const quantity = resolveQuantity(line.id);
      const amount =
        quantity === null
          ? null
          : multiply4(quantity, parseDecimal4(line.saleUnitPrice));
      if (amount !== null) {
        subtotal += amount;
      }
      return {
        amount: amount === null || amount === 0n ? null : formatDecimal4(amount),
        id: line.id,
        quantity: quantity === null ? null : formatDecimal4(quantity),
      };
    });

    return {
      id: scope.id,
      lines,
      subtotal: formatDecimal4(subtotal),
    };
  }
}

function quantityForRule(
  line: QuotationCalculationLineInput,
  scope: QuotationCalculationScopeInput,
  buildingArea: bigint,
  resolveQuantity: (lineId: string) => bigint | null,
): bigint | null {
  switch (line.quantityRule.kind) {
    case "MANUAL":
      return line.manualQuantity === null
        ? null
        : parseDecimal4(line.manualQuantity);
    case "PROJECT_BUILDING_AREA":
      return buildingArea;
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
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}
