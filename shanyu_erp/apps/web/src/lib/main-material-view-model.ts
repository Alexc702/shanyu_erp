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
  "glassColorAssetMap",
  "glassColors",
  "imageReference",
  "variantColor",
  "variantGroup",
]);

const aluminumDoorCasingMaterialId = "MAT-GLASS_DOOR-FBACE026D73F";

export function formatMainMaterialUnit(unit: string): string {
  return ["m2", "m²", "㎡"].includes(unit.trim().toLowerCase()) ? "M²" : unit;
}

export function mainMaterialBaseQuantity(
  line: MainMaterialQuotationLineView,
): string {
  return line.baseQuantity ?? (line.origin === "MANUAL" ? line.quantity : "");
}

export function formatMainMaterialScopeName(scopeName: string): string {
  return scopeName === "项目级" ? "全屋" : scopeName;
}

export function mainMaterialDefaultQuantity(
  item: MainMaterialItemView,
  projectOuterFrameArea: string,
): string {
  return item.categoryCode === "SEAM" && item.itemName === "打胶收口"
    ? projectOuterFrameArea
    : "1";
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

export function mainMaterialProductAsset(
  item: MainMaterialItemView,
): MainMaterialAssetView | undefined {
  return item.materialId === aluminumDoorCasingMaterialId ? undefined : item.assets[0];
}

export function mainMaterialGlassColors(
  item: MainMaterialItemView,
): readonly string[] {
  try {
    const colors = JSON.parse(item.attributes.glassColors ?? "[]") as unknown;
    return Array.isArray(colors)
      ? colors.filter((color): color is string => typeof color === "string" && Boolean(color))
      : [];
  } catch {
    return [];
  }
}

export function mainMaterialGlassColorAsset(
  item: MainMaterialItemView,
  color: string,
): MainMaterialAssetView | undefined {
  if (!color) return undefined;
  try {
    const mapping = JSON.parse(
      item.attributes.glassColorAssetMap ?? "{}",
    ) as Record<string, string>;
    const assetId = mapping[color];
    return assetId ? item.assets.find((asset) => asset.id === assetId) : undefined;
  } catch {
    return undefined;
  }
}

export function encodeMainMaterialGlassDoorSelection(
  frameColor: string,
  glassColor: string,
): string {
  if (!glassColor) return frameColor;
  return frameColor
    ? `门框：${frameColor}｜玻璃：${glassColor}`
    : `玻璃：${glassColor}`;
}

export function decodeMainMaterialGlassDoorSelection(value: string): {
  readonly frameColor: string;
  readonly glassColor: string;
} {
  const match = /^门框：(.+)｜玻璃：(.+)$/.exec(value);
  if (match) return { frameColor: match[1] ?? "", glassColor: match[2] ?? "" };
  return value.startsWith("玻璃：")
    ? { frameColor: "", glassColor: value.slice(3) }
    : { frameColor: value, glassColor: "" };
}

export function visibleMainMaterialAttributes(
  attributes: Readonly<Record<string, string>>,
): readonly [string, string][] {
  return Object.entries(attributes).filter(
    ([key, value]) => !internalAttributeKeys.has(key) && Boolean(value),
  );
}
