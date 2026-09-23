export function isMainMaterialTileSpecCompatible(
  demandName: string,
  demandSpec: string,
  item: { readonly itemName: string; readonly spec: string },
): boolean {
  const normalize = (value: string) => value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
  if (demandName.startsWith("多规格古堡砖") && normalize(demandSpec) === "多规格") {
    // Older bound catalogs named these same combined-size castle products simply “瓷砖”.
    return item.itemName === "古堡砖" || (item.itemName === "瓷砖" &&
      normalize(item.spec) === "200*200/200*400/400*400/400*600");
  }
  return normalize(demandSpec) === normalize(item.spec);
}

interface ColorSelectableMainMaterial {
  readonly materialId?: string;
  readonly brand?: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly categoryCode: string;
  readonly colors: readonly string[];
}

export function isMainMaterialColorSelectionValid(
  item: ColorSelectableMainMaterial,
  color: string | null,
  requireShowerType = false,
): boolean {
  const isLange34A = item.categoryCode === "SHOWER" && item.brand === "朗格"
    && item.materialId === "MAT-SHOWER-DC6F85FFDF14";
  const configuredTypes = item.categoryCode === "SHOWER" ? parseStringArray(item.attributes.showerTypes) : [];
  // Old snapshots may contain only a colour. Require the new type on explicit reselection, not historical reads.
  if (isLange34A && !requireShowerType && !configuredTypes.length && color && item.colors.includes(color)) return true;
  const showerTypes = isLange34A ? ["钻石型", "T型", "一固一开"] : configuredTypes;
  if (showerTypes.length) {
    const match = /^类型：(.+)｜颜色：(.+)$/.exec(color ?? "");
    return Boolean(match && showerTypes.includes(match[1]!) && item.colors.includes(match[2]!));
  }
  const glassColors = item.categoryCode === "GLASS_DOOR"
    ? parseStringArray(item.attributes.glassColors)
    : [];
  if (glassColors.length) {
    if (!color) return false;
    const match = /^门框：(.+)｜玻璃：(.+)$/.exec(color);
    const frameColor = match?.[1] ?? "";
    const glassColor = match?.[2] ?? (color.startsWith("玻璃：") ? color.slice(3) : "");
    return glassColors.includes(glassColor) && (
      item.colors.length ? item.colors.includes(frameColor) : !frameColor
    );
  }
  if (item.colors.length) return Boolean(color && item.colors.includes(color));
  return !color;
}

function parseStringArray(value: string | undefined): readonly string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && Boolean(entry))
      : [];
  } catch {
    return [];
  }
}
