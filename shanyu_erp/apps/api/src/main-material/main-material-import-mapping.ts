import { normalizeCabinetVariant } from "./main-material-cabinet-mapping";
import { MainMaterialSelectionError, type MainMaterialItem, type NormalizedMainMaterialItem } from "./main-material.repository";

export function mapFullImportItem(
  source: NormalizedMainMaterialItem,
  previous?: NormalizedMainMaterialItem & { readonly assetIds?: readonly string[] },
): NormalizedMainMaterialItem {
  const same = previous?.materialId === source.materialId && previous.categoryCode === source.categoryCode ? previous : undefined;
  if (previous && !same && previous.assetIds?.length) {
    throw new MainMaterialSelectionError(`${source.materialId}：分类变化需先核对图片和选型关联`);
  }
  const item = normalizeMaterialVariant(source, same);
  if (same?.assetIds?.length && item.attributes.variantGroup &&
      JSON.stringify(item.colors) !== JSON.stringify(same.colors)) {
    throw new MainMaterialSelectionError(`${item.materialId}：颜色变体变化需先核对产品图片，不能沿用原颜色图片`);
  }
  const attributes: Record<string, string> = { ...item.attributes };
  for (const key of ["colorAssetMap", "glassColors", "glassColorAssetMap", "selectionReferences"]) {
    if (same?.attributes[key]) attributes[key] = same.attributes[key];
  }
  if (same && item.attributes.imageReference !== same.attributes.imageReference && item.status !== "INACTIVE") {
    throw new MainMaterialSelectionError(`${item.materialId}：产品图引用已变化，需先核对并登记图片资产，不能沿用旧图`);
  }
  if (item.attributes.imageReference && !same?.assetIds?.length && item.status !== "INACTIVE") {
    throw new MainMaterialSelectionError(`${item.materialId}：产品图缺少已登记资产，不能只发布图片引用`);
  }
  if (source.selectionOptions) {
    const frame = source.selectionOptions.filter((o) => o.type === "门框颜色");
    const glass = source.selectionOptions.filter((o) => o.type === "玻璃颜色");
    if (JSON.stringify(frame.map((o) => o.name)) !== JSON.stringify(item.colors)) {
      throw new MainMaterialSelectionError(`${item.materialId}：门框颜色与选型关系不一致`);
    }
    if (item.materialId === "MAT-GLASS_DOOR-FBACE026D73F" && glass.length) {
      throw new MainMaterialSelectionError("铝合金门套不允许玻璃颜色选项");
    }
    const references = jsonMap(same?.attributes.selectionReferences);
    for (const option of source.selectionOptions) {
      const key = `${option.type}:${option.name}`;
      if (references[key] && references[key] !== option.imageReference) {
        throw new MainMaterialSelectionError(`${item.materialId}：${option.name}色卡图片引用已变化，需先核对图片资产`);
      }
    }
    attributes.selectionReferences = JSON.stringify(Object.fromEntries(source.selectionOptions.map((o) => [`${o.type}:${o.name}`, o.imageReference])));
    attributes.glassColors = JSON.stringify(glass.map((o) => o.name));
  }
  for (const [mapKey, colors] of [
    ["colorAssetMap", item.colors],
    ["glassColorAssetMap", JSON.parse(attributes.glassColors || "[]") as string[]],
  ] as const) {
    const mapping = jsonMap(attributes[mapKey]);
    if (!attributes[mapKey] && !source.selectionOptions) continue;
    const kept: Record<string, string> = {};
    for (const color of colors) {
      const key = item.categoryCode === "SHOWER" ? color.replace("(镜面)", "（镜面）") : color;
      const assetId = mapping[key];
      if (!assetId || !same?.assetIds?.includes(assetId)) {
        throw new MainMaterialSelectionError(`${item.materialId}：${color}缺少有效色卡资产关联`);
      }
      kept[key] = assetId;
    }
    attributes[mapKey] = JSON.stringify(kept);
  }
  return {
    ...item, attributes,
    // Every FULL publication is a new record snapshot. Never reuse an older token.
    recordVersion: previous?.materialId === item.materialId
      ? Math.max(item.recordVersion, previous.recordVersion + 1) : item.recordVersion,
  };
}

export function normalizeMaterialVariant(
  source: NormalizedMainMaterialItem, previous?: NormalizedMainMaterialItem,
): NormalizedMainMaterialItem {
  let item = normalizeCabinetVariant(source, previous);
  if (item.materialId === "MAT-SHOWER-DC6F85FFDF14" && item.categoryCode === "SHOWER" && item.attributes.type?.includes("；")) {
    const types = item.attributes.type.split("；").map((value) => value.trim());
    if (JSON.stringify(types) !== JSON.stringify(["钻石型", "T型", "一固一开"])) {
      throw new MainMaterialSelectionError(`${item.materialId}：淋浴房类型变化需先核对受控选项`);
    }
    item = { ...item, attributes: { ...item.attributes, showerTypes: JSON.stringify(types) } };
  }
  if (item.brand !== "顾朗" || item.categoryCode !== "BATHROOM" || item.status === "INACTIVE") return item;
  if (item.colors.length !== 1 || !item.colors[0]) throw new MainMaterialSelectionError(`${item.materialId}：顾朗变体必须对应一个颜色`);
  return { ...item, attributes: { ...item.attributes, variantGroup: `顾朗:${item.model}`, variantColor: item.colors[0] } };
}

function jsonMap(value?: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((v) => typeof v !== "string")) {
    throw new MainMaterialSelectionError("色卡映射数据格式无效");
  }
  return parsed as Record<string, string>;
}

export function validateFullImport(
  items: readonly NormalizedMainMaterialItem[], previous: readonly MainMaterialItem[],
): readonly NormalizedMainMaterialItem[] {
  const byId = new Map(previous.map((item) => [item.materialId, item]));
  return items.map((item) => mapFullImportItem(item, byId.get(item.materialId)));
}
