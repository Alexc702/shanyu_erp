import type {
  MainMaterialItemView,
  MainMaterialQuotationLineView,
} from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import {
  findMainMaterialVariant,
  formatMainMaterialUnit,
  groupMainMaterialCandidates,
  mainMaterialBaseQuantity,
  mainMaterialColorAsset,
  mainMaterialDemandEditing,
  visibleMainMaterialAttributes,
} from "./main-material-view-model";

describe("main material view model", () => {
  it("formats every square-metre spelling consistently", () => {
    expect(["M2", "m2", "m²", "㎡"].map(formatMainMaterialUnit)).toEqual([
      "M²", "M²", "M²", "M²",
    ]);
  });

  it("groups indexed colour variants into one selectable product", () => {
    const white = item("white", "暖白", "cabinet");
    const grey = item("grey", "浅灰", "cabinet");
    const groups = groupMainMaterialCandidates([white, grey]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.variants).toEqual([white, grey]);
    expect(findMainMaterialVariant(groups[0]?.variants ?? [], "浅灰")).toBe(grey);
  });

  it("maps a shower-room colour to its indexed colour card", () => {
    const source = {
      ...item("shower", "", ""),
      assets: [
        { id: "product", path: "/product" },
        { id: "black", path: "/black" },
      ],
      attributes: { colorAssetMap: JSON.stringify({ 黑色: "black" }), imageReference: "source" },
    };
    expect(mainMaterialColorAsset(source, "黑色")?.id).toBe("black");
    expect(visibleMainMaterialAttributes(source.attributes)).toEqual([]);
  });

  it("maps every Langge mirror colour when the selector uses half-width brackets", () => {
    const mirrorAssets = {
      "镜光（镜面）": "mirror",
      "法兰金（镜面）": "french-gold",
      "钛金（镜面）": "titanium-gold",
      "玫瑰金（镜面）": "rose-gold",
    };
    const source: MainMaterialItemView = {
      ...item("shower", "", ""),
      assets: Object.values(mirrorAssets).map((id) => ({ id, path: `/${id}` })),
      attributes: { colorAssetMap: JSON.stringify(mirrorAssets) },
      brand: "朗格",
      categoryCode: "SHOWER",
      categoryName: "淋浴房",
    };

    expect([
      "镜光(镜面)",
      "法兰金(镜面)",
      "钛金(镜面)",
      "玫瑰金(镜面)",
    ].map((color) => mainMaterialColorAsset(source, color)?.id)).toEqual([
      "mirror",
      "french-gold",
      "titanium-gold",
      "rose-gold",
    ]);
  });

  it("edits both demand fields for non-tiles but keeps tile base quantity read-only", () => {
    const tile = quotationLine("AUTO_TILE", "TILE", "50.0000", "55.7500");
    const seam = quotationLine("MANUAL", "SEAM", null, "6.0000");

    expect(mainMaterialDemandEditing(tile, true)).toEqual({
      baseQuantity: false,
      lossRate: true,
    });
    expect(mainMaterialDemandEditing(seam, true)).toEqual({
      baseQuantity: true,
      lossRate: true,
    });
    expect(mainMaterialDemandEditing(seam, false)).toEqual({
      baseQuantity: false,
      lossRate: false,
    });
    expect(mainMaterialBaseQuantity(tile)).toBe("50.0000");
    expect(mainMaterialBaseQuantity(seam)).toBe("6.0000");
  });
});

function quotationLine(
  origin: MainMaterialQuotationLineView["origin"],
  categoryCode: MainMaterialQuotationLineView["categoryCode"],
  baseQuantity: string | null,
  quantity: string,
): MainMaterialQuotationLineView {
  return {
    amount: null,
    baseQuantity,
    categoryCode,
    demandName: "测试主材",
    demandSpec: "",
    id: `${categoryCode}-${origin}`,
    item: null,
    lossRate: "0.0000",
    origin,
    quantity,
    scopeName: "项目级",
    selectedColor: null,
  };
}

function item(id: string, color: string, group: string): MainMaterialItemView {
  return {
    assets: [{ id, path: `/${id}` }],
    attributes: { variantColor: color, variantGroup: group },
    brand: "定制浴室柜",
    categoryCode: "BATHROOM",
    categoryName: "卫浴",
    colors: color ? [color] : [],
    id,
    itemName: "浴室柜",
    materialId: id,
    missingFields: "",
    model: "A",
    recordVersion: 1,
    remarks: "",
    salePrice: "100.00",
    series: "",
    spec: "1000",
    status: "ACTIVE",
    unit: "套",
  };
}
