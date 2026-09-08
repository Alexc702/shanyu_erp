import type { HalfPackageQuotationScope } from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import {
  formatQuotationItemName,
  formatDisplayNumber,
  formatQuotationScopeName,
  formatQuotationUnit,
  orderQuotationScopes,
  quotationLineCategory,
  quotationOptionQuantityForToggle,
  quotationOptionModelLabel,
  quotationOptionGroup,
  quotationLinesForDisplay,
  shouldDisplayQuotationOptionLine,
} from "./quotation-view-model";

describe("quotation view model", () => {
  it("shows design-facing numbers with two decimals without changing source precision", () => {
    expect(formatDisplayNumber("13.4217")).toBe("13.42");
    expect(formatDisplayNumber("0.6402")).toBe("0.64");
    expect(formatDisplayNumber(null)).toBe("—");
  });

  it("normalizes square-metre units to the superscript design label", () => {
    expect(formatQuotationUnit("M2")).toBe("M²");
    expect(formatQuotationUnit("m2")).toBe("M²");
    expect(formatQuotationUnit("M")).toBe("M");
  });

  it("orders wall, project spaces, paint, electrical, and other", () => {
    const scopes = [
      scope("十一、水电工程", null),
      scope("次卫", "BATHROOM"),
      scope("厨房", "KITCHEN"),
      scope("十、油漆工程", null),
      scope("次卧", "BEDROOM"),
      scope("一、砌墙工程", null),
      scope("衣帽间", "CLOSET"),
      scope("客餐厅", "LIVING_DINING"),
      scope("主卫", "BATHROOM"),
      scope("主卧", "BEDROOM"),
      scope("生活阳台", "BALCONY"),
      scope("十二、其他工程", null),
    ];

    expect(orderQuotationScopes(scopes).map((item) => item.name)).toEqual([
      "一、砌墙工程",
      "客餐厅",
      "主卧",
      "次卧",
      "衣帽间",
      "主卫",
      "次卫",
      "厨房",
      "生活阳台",
      "十、油漆工程",
      "十一、水电工程",
      "十二、其他工程",
    ]);
  });

  it("隐藏项目级范围名称前的 Excel 章节编号", () => {
    expect(formatQuotationScopeName("一、砌墙工程")).toBe("砌墙工程");
    expect(formatQuotationScopeName("十、油漆工程")).toBe("油漆工程");
    expect(formatQuotationScopeName("主卧")).toBe("主卧");
  });

  it("uses the Excel bracket field as the tile model multi-select item name", () => {
    const cementMortarOptions = [
      "800*800mm地砖（水泥砂浆粘贴）",
      "600*1200mm地砖（水泥砂浆粘贴）",
      "750*1500mm地砖（水泥砂浆粘贴）",
      "多规格古堡砖（水泥砂浆粘贴）",
      "900*1800mm地砖（水泥砂浆粘贴）",
      "木纹砖长条150*900（水泥砂浆粘贴）",
      "木纹砖长条200*1200（水泥砂浆粘贴）",
    ];
    const adhesiveOptions = [
      "200*700mm小砖（胶泥粘帖）",
      "800*800mm墙砖（胶泥粘帖）",
      "600*1200mm墙砖（胶泥粘帖）",
      "750*1500mm墙砖（胶泥粘帖）",
      "900*1800mm墙砖（胶泥粘帖）",
    ];

    expect(cementMortarOptions.map(quotationOptionGroup)).toEqual(
      Array(7).fill("水泥砂浆粘贴"),
    );
    expect(adhesiveOptions.map(quotationOptionGroup)).toEqual(
      Array(5).fill("胶泥粘帖"),
    );
    expect(cementMortarOptions.map(quotationOptionModelLabel)).toEqual([
      "800×800",
      "600×1200",
      "750×1500",
      "多规格古堡砖",
      "900×1800",
      "木纹砖长条150×900",
      "木纹砖长条200×1200",
    ]);
    expect(adhesiveOptions.map(quotationOptionModelLabel)).toEqual([
      "200×700",
      "800×800",
      "600×1200",
      "750×1500",
      "900×1800",
    ]);
    expect(quotationOptionGroup("瓜子片豆石精找平")).toBe("找平做法");
    expect(quotationOptionGroup("包管道（1根）")).toBeNull();
    expect(quotationOptionGroup("石膏板吊平顶")).toBeNull();
    expect(formatQuotationItemName("800*800mm地砖（水泥砂浆粘贴）")).toBe(
      "800*800mm地砖",
    );
    expect(formatQuotationItemName("800*800mm墙砖（胶泥粘帖）")).toBe(
      "800*800mm墙砖",
    );
  });

  it("shows only selected lines below every Excel multi-select group", () => {
    expect(
      shouldDisplayQuotationOptionLine(
        "800*800mm地砖（水泥砂浆粘贴）",
        false,
      ),
    ).toBe(false);
    expect(
      shouldDisplayQuotationOptionLine("800*800mm墙砖（胶泥粘帖）", true),
    ).toBe(true);
    expect(shouldDisplayQuotationOptionLine("粗找平", false)).toBe(false);
    expect(shouldDisplayQuotationOptionLine("粗找平", true)).toBe(true);
    expect(shouldDisplayQuotationOptionLine("（薄贴）瓷砖增加人工费", false)).toBe(
      true,
    );
    expect(
      shouldDisplayQuotationOptionLine("填充后细石砼地面找平", false),
    ).toBe(true);
    expect(
      shouldDisplayQuotationOptionLine("双层石膏板（墙面找平）", false),
    ).toBe(true);
  });

  it("clears an old manual quantity when a multi-select option is unchecked", () => {
    expect(quotationOptionQuantityForToggle("2.5000", false)).toBeNull();
    expect(quotationOptionQuantityForToggle("2.5000", true)).toBe("2.5000");
  });

  it("shows only selected positive-quantity lines in a generated quotation", () => {
    const lines = [
      { id: "selected", quantity: "2.0000", selected: true },
      { id: "zero", quantity: "0.0000", selected: true },
      { id: "blank", quantity: null, selected: true },
      { id: "not-selected", quantity: "2.0000", selected: false },
    ];

    expect(quotationLinesForDisplay(lines, false)).toEqual(lines);
    expect(quotationLinesForDisplay(lines, true)).toEqual([lines[0]]);
  });

  it("uses the category labels defined by the reviewed Pencil screens", () => {
    expect(quotationLineCategory("120墙体拆除", "一、砌墙工程")).toBe("砌墙");
    expect(quotationLineCategory("墙面水性防水涂料", "二、客餐厅工程")).toBe("防水");
    expect(quotationLineCategory("600*1200mm地砖（水泥砂浆粘贴）", "三、卧室工程")).toBe("泥工贴砖");
    expect(quotationLineCategory("斜铺/人字贴人工费", "三、卧室工程")).toBe("泥工贴砖");
    expect(quotationLineCategory("粗找平", "八、厨卫工程")).toBe("找平");
    expect(quotationLineCategory("石膏板吊平顶", "二、客餐厅工程")).toBe("木工吊顶");
    expect(quotationLineCategory("顶面乳胶漆", "三、卧室工程")).toBe("油漆");
    expect(quotationLineCategory("开管线槽", "十一、水电工程")).toBe("水电");
    expect(quotationLineCategory("装修建筑垃圾外运", "十二、其他工程")).toBe("其他");
    expect(quotationLineCategory("包管道（1根）", "七、阳台工程", "LIVING_DINING")).toBe("包阳台");
    expect(quotationLineCategory("包管道（1根）", "七、阳台工程", "BALCONY")).toBe("包管");
  });
});

function scope(
  name: string,
  spaceType: HalfPackageQuotationScope["spaceType"],
): HalfPackageQuotationScope {
  return {
    area: null,
    height: null,
    id: name,
    lines: [],
    name,
    perimeter: null,
    projectSpaceId: null,
    spaceType,
    subtotal: "0.0000",
  };
}
