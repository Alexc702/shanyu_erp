import type {
  MainMaterialAssetView,
  MainMaterialItemView,
  MainMaterialQuotationLineView,
} from "@shanyu/contracts";

export interface MainMaterialCandidateGroup {
  readonly key: string;
  readonly primary: MainMaterialItemView;
  readonly variants: readonly MainMaterialItemView[];
}

const internalAttributeKeys = new Set([
  "colorAssetMap",
  "imageReference",
  "variantColor",
  "variantGroup",
]);

export function formatMainMaterialUnit(unit: string): string {
  return ["m2", "m²", "㎡"].includes(unit.trim().toLowerCase()) ? "M²" : unit;
}

export function mainMaterialBaseQuantity(
  line: MainMaterialQuotationLineView,
): string {
  return line.baseQuantity ?? (line.origin === "MANUAL" ? line.quantity : "");
}

export function mainMaterialDemandEditing(
  line: MainMaterialQuotationLineView,
  editable: boolean,
): { readonly baseQuantity: boolean; readonly lossRate: boolean } {
  return {
    baseQuantity: editable && line.origin === "MANUAL",
    lossRate: editable,
  };
}

export function mainMaterialCandidateKey(item: MainMaterialItemView): string {
  return item.attributes.variantGroup || item.id;
}

export function mainMaterialVariantColor(item: MainMaterialItemView): string {
  return item.attributes.variantColor || (item.colors.length === 1 ? item.colors[0] ?? "" : "");
}

export function groupMainMaterialCandidates(
  items: readonly MainMaterialItemView[],
): readonly MainMaterialCandidateGroup[] {
  const groups = new Map<string, MainMaterialItemView[]>();
  for (const item of items) {
    const key = mainMaterialCandidateKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, variants]) => ({
    key,
    primary: variants[0] as MainMaterialItemView,
    variants,
  }));
}

export function findMainMaterialVariant(
  variants: readonly MainMaterialItemView[],
  color: string,
): MainMaterialItemView | undefined {
  return variants.find((item) => mainMaterialVariantColor(item) === color);
}

export function mainMaterialColorAsset(
  item: MainMaterialItemView,
  color: string,
): MainMaterialAssetView | undefined {
  if (!color) return undefined;
  try {
    const mapping = JSON.parse(item.attributes.colorAssetMap ?? "{}") as Record<string, string>;
    const indexedColor = item.categoryCode === "SHOWER" && item.brand === "朗格"
      ? color.replace("(镜面)", "（镜面）")
      : color;
    const assetId = mapping[color] ?? mapping[indexedColor];
    return assetId ? item.assets.find((asset) => asset.id === assetId) : undefined;
  } catch {
    return undefined;
  }
}

export function visibleMainMaterialAttributes(
  attributes: Readonly<Record<string, string>>,
): readonly [string, string][] {
  return Object.entries(attributes).filter(
    ([key, value]) => !internalAttributeKeys.has(key) && Boolean(value),
  );
}
