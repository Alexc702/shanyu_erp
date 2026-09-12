import type {
  HalfPackageQuotationLine,
  HalfPackageQuotationScope,
} from "@shanyu/contracts";

export function formatDisplayNumber(value: string | null): string {
  if (value === null || value.trim() === "") {
    return "—";
  }
  return Number(value).toFixed(2);
}

export function formatQuotationUnit(unit: string): string {
  return /^m2$/i.test(unit.trim()) ? "M²" : unit;
}

export function formatQuotationScopeName(name: string): string {
  return name.replace(/^[一二三四五六七八九十]+、/, "");
}

export function formatQuotationItemName(name: string): string {
  return name.replace(/[（(](水泥砂浆粘贴|胶泥粘帖)[）)]$/, "").trim();
}

export function orderQuotationScopes(
  scopes: readonly HalfPackageQuotationScope[],
): HalfPackageQuotationScope[] {
  return [...scopes];
}

export function orderQuotationOptionLines<
  T extends Pick<HalfPackageQuotationLine, "itemName">,
>(lines: readonly T[]): T[] {
  const linesByGroup = new Map<
    NonNullable<ReturnType<typeof quotationOptionGroup>>,
    T[]
  >();
  for (const line of lines) {
    const group = quotationOptionGroup(line.itemName);
    if (!group) continue;
    linesByGroup.set(group, [...(linesByGroup.get(group) ?? []), line]);
  }

  const renderedGroups = new Set<string>();
  return lines.flatMap((line) => {
    const group = quotationOptionGroup(line.itemName);
    if (!group) return [line];
    if (renderedGroups.has(group)) return [];
    renderedGroups.add(group);
    return linesByGroup.get(group) ?? [];
  });
}

export function quotationOptionGroup(
  itemName: HalfPackageQuotationLine["itemName"],
): "水泥砂浆粘贴" | "胶泥粘帖" | "找平做法" | null {
  const tileOption = matchTileOption(itemName);
  if (tileOption) {
    return tileOption.group;
  }
  if (/找平/.test(itemName) && !/墙面找平|填充后/.test(itemName)) {
    return "找平做法";
  }
  return null;
}

export function quotationOptionModelLabel(
  itemName: HalfPackageQuotationLine["itemName"],
): string {
  const tileOption = matchTileOption(itemName);
  return tileOption ? tileOption.label : itemName;
}

export function shouldDisplayQuotationOptionLine(
  itemName: HalfPackageQuotationLine["itemName"],
  selected: HalfPackageQuotationLine["selected"],
): boolean {
  return quotationOptionGroup(itemName) === null || selected;
}

export function quotationOptionQuantityForToggle(
  quantity: HalfPackageQuotationLine["quantity"],
  selected: HalfPackageQuotationLine["selected"],
): string | null {
  return selected ? quantity : null;
}

export function quotationLinesForDisplay<
  T extends Pick<HalfPackageQuotationLine, "quantity" | "selected">,
>(lines: readonly T[], compactReadOnly: boolean): readonly T[] {
  if (!compactReadOnly) return lines;
  return lines.filter(
    (line) => line.selected && Number(line.quantity ?? "0") > 0,
  );
}

export function quotationLineCategory(
  itemName: string,
  sectionName = "",
  scopeSpaceType: HalfPackageQuotationScope["spaceType"] = null,
): string {
  if (sectionName.includes("砌墙工程")) return "砌墙";
  if (sectionName.includes("水电工程")) return "水电";
  if (sectionName.includes("其他工程")) return "其他";
  if (sectionName.includes("油漆工程")) return "项目级";
  if (sectionName.includes("阳台工程")) {
    return scopeSpaceType === "LIVING_DINING" ? "包阳台" : "包管";
  }
  if (sectionName.includes("厨卫工程")) {
    if (/包管道/.test(itemName)) return "包管";
    if (/水性防水涂料/.test(itemName)) return "防水";
    if (isTileItem(itemName)) return "泥工贴砖";
    if (isLevellingOption(itemName)) return "找平";
    if (/下沉式淋浴房|壁龛|防水石膏板吊平顶|顶面基层处理|顶面防水乳胶漆/.test(itemName)) {
      return "其他";
    }
    return "基础";
  }
  if (sectionName.includes("客餐厅工程") || sectionName.includes("卧室工程")) {
    if (/包管道/.test(itemName)) return "包管";
    if (/^(顶面基层处理|顶面乳胶漆|墙面基层处理|墙面乳胶漆)$/.test(itemName)) return "油漆";
    if (/水性防水涂料/.test(itemName)) return "防水";
    if (isTileItem(itemName)) return "泥工贴砖";
    if (isLevellingOption(itemName)) return "找平";
    if (/石膏板|欧松板|吊顶|吊斜顶|窗帘盒|灯|空调出风|木制地台|电视背景/.test(itemName)) return "木工吊顶";
    return "基础";
  }
  return "常规项目";
}

function isTileItem(itemName: string): boolean {
  return (
    matchTileOption(itemName) !== null ||
    /瓷砖增加人工费|斜铺\/人字贴人工费/.test(itemName)
  );
}

function isLevellingOption(itemName: string): boolean {
  return /^(粗找平|瓜子片豆石精找平|半干成品砂浆找平)$/.test(itemName);
}

function matchTileOption(itemName: string): {
  readonly group: "水泥砂浆粘贴" | "胶泥粘帖";
  readonly label: string;
} | null {
  const match = itemName.match(/^(.+)（(水泥砂浆粘贴|胶泥粘帖)）$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    group: match[2] as "水泥砂浆粘贴" | "胶泥粘帖",
    label: match[1]
      .replace(/mm(?:地砖|墙砖|小砖)$/, "")
      .replaceAll("*", "×"),
  };
}
