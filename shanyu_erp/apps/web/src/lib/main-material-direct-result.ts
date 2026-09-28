import type { DirectMaterialRowView } from "@shanyu/contracts";

export const directUnitOptions = [["M","米（M）"],["M²","平米（M²）"],["个","个"],["套","套"],["樘","樘"],["片","片"]] as const;
export function directUnitValue(unit?: string) {
  if (["米","M"].includes(unit ?? "")) return "M";
  if (["平方","平米","平方米","M²"].includes(unit ?? "")) return "M²";
  return unit;
}

export function directChangeCounts(rows: readonly Pick<DirectMaterialRowView, "result" | "differences">[]) {
  const changed = rows.filter(row => row.result === "NEW" || row.result === "UPDATE");
  return {
    prices: changed.filter(row => row.differences.some(diff => diff.field === "salePrice" || diff.field === "costPrice")).length,
    images: changed.filter(row => row.differences.some(diff => diff.field === "产品图")).length,
  };
}
