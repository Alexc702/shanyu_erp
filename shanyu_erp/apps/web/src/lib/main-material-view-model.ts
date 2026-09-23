import type {
  MainMaterialAssetView,
  MainMaterialItemView,
  MainMaterialQuotationLineView,
} from "@shanyu/contracts";

export function mainMaterialTileSpecCompatible(
  demandName: string,
  demandSpec: string,
  item: Pick<MainMaterialItemView, "itemName" | "spec">,
): boolean {
  const normalize = (value: string) => value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
  if (demandName.startsWith("多规格古堡砖") && normalize(demandSpec) === "多规格") {
    return item.itemName === "古堡砖" || (item.itemName === "瓷砖" &&
      normalize(item.spec) === "200*200/200*400/400*400/400*600");
  }
  return normalize(demandSpec) === normalize(item.spec);
}

export interface MainMaterialCandidateGroup {
  readonly key: string;
  readonly primary: MainMaterialItemView;
  readonly variants: readonly MainMaterialItemView[];
}

const internalAttributeKeys = new Set([
  "configurationDescription",
  "showerTypes",
  "colorAssetMap",
  "glassColorAssetMap",
  "glassColors",
  "imageReference",
  "variantColor",
  "variantGroup",
]);

const aluminumDoorCasingMaterialId = "MAT-GLASS_DOOR-FBACE026D73F";

export function mainMaterialDisplayModel(
  item: Pick<MainMaterialItemView, "materialId" | "itemName" | "model">,
): string {
  return item.materialId === "MAT-SEAM-A179F09722C2" && item.model === "美缝"
    ? item.itemName
    : item.model || item.itemName;
}

export function formatMainMaterialUnit(unit: string): string {
  return ["m2", "m²", "㎡"].includes(unit.trim().toLowerCase()) ? "M²" : unit;
}

// Presentation only. Inputs and API requests retain their original precision.
export function formatMainMaterialQuantity(value: string, unit: string): string {
  const metric = ["m", "米", "m2", "m²", "㎡", "平米", "平方", "平方米"].includes(unit.trim().toLowerCase());
  return new Intl.NumberFormat("zh-CN", { useGrouping: false,
    minimumFractionDigits: metric ? 1 : 0, maximumFractionDigits: metric ? 1 : 0,
  }).format(Number(value));
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
  const unit = formatMainMaterialUnit(
    line.item?.unit ?? (line.origin === "AUTO_TILE" ? "M²" : ""),
  ).trim().toLowerCase();
  return {
    baseQuantity: editable && line.origin === "MANUAL",
    lossRate: editable && ["m", "米", "m²", "平米", "平方", "平方米"].includes(unit),
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

export function isLange34A(item: { readonly materialId: string; readonly brand: string }): boolean {
  return item.materialId === "MAT-SHOWER-DC6F85FFDF14" && item.brand === "朗格";
}

export function mainMaterialSelectionDescription(
  item: Parameters<typeof mainMaterialDisplayModel>[0] & { readonly brand: string },
  selectedColor: string | null,
  catalogItem?: MainMaterialItemView,
): string {
  const model = mainMaterialDisplayModel(item);
  if (item.brand === "铂屿定制" && /^(免漆|烤漆)浴室柜（(主卫|公卫)）$/.test(item.itemName)
      && catalogItem?.materialId === item.materialId && catalogItem.categoryCode === "BATHROOM") {
    return [model, selectedColor, catalogItem.attributes.configurationDescription].filter(Boolean).join(" · ");
  }
  if (!isLange34A(item) && catalogItem?.materialId === item.materialId && catalogItem.categoryCode === "SHOWER") {
    const selection = decodeMainMaterialShowerSelection(selectedColor ?? "");
    const type = selection.type || catalogItem.attributes.type?.trim()
      || catalogItem.spec.split(/[\r\n]+/).map((part) => part.trim())
        .find((part) => /型淋浴房$/.test(part) || /^一固一[移开]系列$/.test(part))?.replace(/系列$/, "");
    return [model, type, selection.color].filter(Boolean).join(" · ");
  }
  if (!isLange34A(item)) return `${model}${selectedColor ? ` · ${selectedColor}` : ""}`;
  const selection = decodeMainMaterialShowerSelection(selectedColor ?? "");
  return [model, selection.type, selection.color].filter(Boolean).join(" · ");
}

export function mainMaterialShowerTypes(item: MainMaterialItemView): readonly string[] {
  if (item.categoryCode !== "SHOWER") return [];
  if (isLange34A(item)) return ["钻石型", "T型", "一固一开"];
  try {
    const types: unknown = JSON.parse(item.attributes.showerTypes ?? "[]");
    return Array.isArray(types) ? types.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
  } catch {
    return [];
  }
}

export function decodeMainMaterialShowerSelection(value: string): { type: string; color: string } {
  const match = /^类型：(.*)｜颜色：(.*)$/.exec(value);
  return match ? { type: match[1]!, color: match[2]! } : { type: "", color: value };
}

export function encodeMainMaterialShowerSelection(type: string, color: string): string {
  return type ? `类型：${type}｜颜色：${color}` : color;
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
