import type {
  MainMaterialItemView,
  MainMaterialQuotationLineView,
} from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import {
  decodeMainMaterialGlassDoorSelection,
  encodeMainMaterialGlassDoorSelection,
  findMainMaterialVariant,
  formatMainMaterialScopeName,
  formatMainMaterialUnit,
  groupMainMaterialCandidates,
  mainMaterialBaseQuantity,
  mainMaterialColorAsset,
  mainMaterialDefaultQuantity,
  mainMaterialDemandEditing,
  mainMaterialGlassColorAsset,
  mainMaterialGlassColors,
  mainMaterialProductAsset,
  visibleMainMaterialAttributes,
} from "./main-material-view-model";

describe("main material view model", () => {
  it("formats every square-metre spelling consistently", () => {
    expect(["M2", "m2", "m²", "㎡"].map(formatMainMaterialUnit)).toEqual([
      "M²", "M²", "M²", "M²",
    ]);
  });

  it("shows project-level material demand as whole-house scope", () => {
    expect(formatMainMaterialScopeName("项目级")).toBe("全屋");
    expect(formatMainMaterialScopeName("客餐厅")).toBe("客餐厅");
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

  it("maps every glass-door colour without replacing its product image", () => {
    const source: MainMaterialItemView = {
      ...item("glass-door", "", ""),
      assets: [
        { id: "product", path: "/product" },
        { id: "black", path: "/black" },
        { id: "grey", path: "/grey" },
      ],
      attributes: {
        colorAssetMap: JSON.stringify({ 瓷泳黑: "black", 瓷泳灰: "grey" }),
        imageReference: "source",
      },
      brand: "铂屿定制",
      categoryCode: "GLASS_DOOR",
      categoryName: "房门|门套 - 玻璃门",
      colors: ["瓷泳黑", "瓷泳灰"],
    };

    expect(source.assets[0]?.id).toBe("product");
    expect(source.colors.map((candidate) => mainMaterialColorAsset(source, candidate)?.id)).toEqual([
      "black",
      "grey",
    ]);
  });

  it("keeps glass-door frame and glass selections separate and indexed", () => {
    const source: MainMaterialItemView = {
      ...item("glass-door", "", ""),
      assets: [
        { id: "product", path: "/product" },
        { id: "frame-black", path: "/frame-black" },
        { id: "glass-white", path: "/glass-white" },
      ],
      attributes: {
        colorAssetMap: JSON.stringify({ 瓷泳黑: "frame-black" }),
        glassColorAssetMap: JSON.stringify({ "8MM 超白玻": "glass-white" }),
        glassColors: JSON.stringify(["8MM 超白玻"]),
      },
      brand: "铂屿定制",
      categoryCode: "GLASS_DOOR",
      categoryName: "房门|门套 - 玻璃门",
      colors: ["瓷泳黑"],
    };

    expect(mainMaterialGlassColors(source)).toEqual(["8MM 超白玻"]);
    expect(mainMaterialGlassColorAsset(source, "8MM 超白玻")?.id).toBe("glass-white");
    const encoded = encodeMainMaterialGlassDoorSelection("瓷泳黑", "8MM 超白玻");
    expect(encoded).toBe("门框：瓷泳黑｜玻璃：8MM 超白玻");
    expect(decodeMainMaterialGlassDoorSelection(encoded)).toEqual({
      frameColor: "瓷泳黑",
      glassColor: "8MM 超白玻",
    });
    expect(decodeMainMaterialGlassDoorSelection("玻璃：8mm欧洲灰")).toEqual({
      frameColor: "",
      glassColor: "8mm欧洲灰",
    });
  });

  it("keeps the aluminum door casing image blank and stores only its frame colour", () => {
    const source: MainMaterialItemView = {
      ...item("frame-card", "", ""),
      assets: [{ id: "frame-card", path: "/frame-card" }],
      categoryCode: "GLASS_DOOR",
      categoryName: "房门|门套 - 玻璃门",
      materialId: "MAT-GLASS_DOOR-FBACE026D73F",
    };

    expect(mainMaterialProductAsset(source)).toBeUndefined();
    expect(encodeMainMaterialGlassDoorSelection("瓷泳黑", "")).toBe("瓷泳黑");
    expect(decodeMainMaterialGlassDoorSelection("瓷泳黑")).toEqual({
      frameColor: "瓷泳黑",
      glassColor: "",
    });
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

  it("uses the project outer-frame area for sealant quantity", () => {
    const sealant = {
      ...item("sealant", "", ""),
      categoryCode: "SEAM" as const,
      categoryName: "美缝",
      itemName: "打胶收口",
    };
    expect(mainMaterialDefaultQuantity(sealant, "128.5000")).toBe("128.5000");
    expect(mainMaterialDefaultQuantity(item("floor", "", ""), "128.5000")).toBe("1");
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
