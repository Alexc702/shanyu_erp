interface ColorSelectableMainMaterial {
  readonly attributes: Readonly<Record<string, string>>;
  readonly categoryCode: string;
  readonly colors: readonly string[];
}

export function isMainMaterialColorSelectionValid(
  item: ColorSelectableMainMaterial,
  color: string | null,
): boolean {
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
