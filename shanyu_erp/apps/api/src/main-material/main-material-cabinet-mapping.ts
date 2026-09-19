import {
  MainMaterialSelectionError,
  type NormalizedMainMaterialItem,
} from "./main-material.repository";

const cabinetModels = new Set([
  "免漆浴室柜（主卫）", "免漆浴室柜（公卫）",
  "烤漆浴室柜（主卫）", "烤漆浴室柜（公卫）",
]);
const delifengPrefix = /^德利丰(?:（大板）)?\s*[-－]\s*/;

// One stable material_id represents one cabinet + core-material colour variant.
// Source rows locate evidence; they never determine the group, colour or price.
export function normalizeCabinetVariant<Item extends NormalizedMainMaterialItem>(
  item: Item,
  previous?: NormalizedMainMaterialItem,
): Item {
  if (item.categoryCode !== "BATHROOM" || !cabinetModels.has(item.itemName)) return item;
  const sourceColor = item.colors[0]?.trim();
  if (item.colors.length !== 1 || !sourceColor) {
    throw new MainMaterialSelectionError(
      `${item.materialId}：每条定制浴室柜记录必须对应一个核心主材颜色`,
    );
  }

  const reference = previous?.materialId === item.materialId ? previous : item;
  const approvedColor = reference.attributes.variantColor ?? "";
  const sameColor = approvedColor && reference.colors.includes(approvedColor) &&
    approvedColor.replace(delifengPrefix, "") === sourceColor.replace(delifengPrefix, "");
  const variantColor = sameColor
    ? approvedColor
    : delifengPrefix.test(item.model) || delifengPrefix.test(sourceColor)
      ? `德利丰（大板）-${sourceColor.replace(delifengPrefix, "")}`
      : sourceColor;

  return {
    ...item,
    model: item.itemName,
    colors: [variantColor],
    attributes: {
      ...item.attributes,
      variantGroup: `定制浴室柜:${item.itemName}`,
      variantColor,
    },
  };
}
