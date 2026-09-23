import type {
  MainMaterialItemView,
  MainMaterialQuotationLineView,
} from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import {
  decodeMainMaterialGlassDoorSelection,
  decodeMainMaterialShowerSelection,
  encodeMainMaterialShowerSelection,
  encodeMainMaterialGlassDoorSelection,
  findMainMaterialVariant,
  formatMainMaterialScopeName,
  formatMainMaterialUnit,
  formatMainMaterialQuantity,
  mainMaterialTileSpecCompatible,
  groupMainMaterialCandidates,
  mainMaterialBaseQuantity,
  mainMaterialColorAsset,
  mainMaterialDefaultQuantity,
  mainMaterialDisplayModel,
  mainMaterialDemandEditing,
  mainMaterialGlassColorAsset,
  mainMaterialGlassColors,
  mainMaterialProductAsset,
  mainMaterialShowerTypes,
  mainMaterialSelectionDescription,
  visibleMainMaterialAttributes,
} from "./main-material-view-model";

describe("main material view model", () => {
  it.each(["移门 21AT", "开门 36A"])("shows %s with its catalog shower type and saved colour without changing data", (model) => {
    const shower: MainMaterialItemView = { ...item("shower", "枪灰拉丝", ""), categoryCode: "SHOWER", brand: "朗格", model,
      spec: "T型淋浴房\n内外开系列\n全套悬挂转轴淋浴房", attributes: {} };
    const before = structuredClone(shower);
    expect(mainMaterialSelectionDescription(shower, "枪灰拉丝", shower)).toBe(`${model} · T型淋浴房 · 枪灰拉丝`);
    expect(mainMaterialSelectionDescription(shower, null, shower)).toBe(`${model} · T型淋浴房`);
    expect(mainMaterialSelectionDescription(shower, "类型：钻石型｜颜色：亮银", shower)).toBe(`${model} · 钻石型 · 亮银`);
    expect(mainMaterialSelectionDescription(shower, "枪灰拉丝", { ...shower, materialId: "other" })).toBe(`${model} · 枪灰拉丝`);
    expect(mainMaterialSelectionDescription(shower, "枪灰拉丝", { ...shower, spec: "全套高定移门淋浴房" })).toBe(`${model} · 枪灰拉丝`);
    expect(mainMaterialSelectionDescription(shower, "枪灰拉丝", { ...shower, spec: "朗格46A移门\n一固一移系列\n全套高定移门淋浴房" })).toBe(`${model} · 一固一移 · 枪灰拉丝`);
    expect(shower).toEqual(before);
  });
  it.each(["免漆", "烤漆"])("shows %s cabinet configuration in the selected model description from the bound catalog", (finish) => {
    const cabinet: MainMaterialItemView = { ...item("cabinet", "熊猫白", "cabinet"), brand: "铂屿定制", categoryCode: "BATHROOM",
      itemName: `${finish}浴室柜（主卫）`, model: `${finish}浴室柜（主卫）`,
      attributes: { configurationDescription: `定制镜柜、${finish}柜体、科勒陶瓷盆（按米收费）、不含龙头` } };
    const original = structuredClone(cabinet);
    expect(mainMaterialSelectionDescription(cabinet, "熊猫白", cabinet)).toBe(`${cabinet.model} · 熊猫白 · ${cabinet.attributes.configurationDescription}`);
    expect(mainMaterialSelectionDescription(cabinet, "熊猫白")).toBe(`${cabinet.model} · 熊猫白`);
    expect(mainMaterialSelectionDescription(cabinet, "熊猫白", { ...cabinet, materialId: "other" })).toBe(`${cabinet.model} · 熊猫白`);
    expect(mainMaterialSelectionDescription({ ...cabinet, brand: "其他品牌" }, "熊猫白", cabinet)).toBe(`${cabinet.model} · 熊猫白`);
    expect(cabinet).toEqual(original);
  });
  it("offers current and legacy castle tiles only for the multi-size castle demand", () => {
    const spec = "200*200/200*400/400*400/400*600";
    for (const itemName of ["古堡砖", "瓷砖"]) {
      expect(mainMaterialTileSpecCompatible("多规格古堡砖（水泥砂浆粘贴）", "多规格", { itemName, spec })).toBe(true);
    }
    expect(mainMaterialTileSpecCompatible("多规格古堡砖（水泥砂浆粘贴）", "多规格", { itemName: "其他砖", spec: "多规格" })).toBe(false);
    expect(mainMaterialTileSpecCompatible("多规格古堡砖（水泥砂浆粘贴）", "多规格", { itemName: "瓷砖", spec: "800*800" })).toBe(false);
    expect(mainMaterialTileSpecCompatible("800mm地砖", "800×800mm", { itemName: "瓷砖", spec: "800*800" })).toBe(true);
    expect(mainMaterialTileSpecCompatible("800mm地砖", "800*800", { itemName: "古堡砖", spec })).toBe(false);
  });
  it("shows fixed types and saved model/type/colour only for Lange 34A, including old catalogs", () => {
    const shower: MainMaterialItemView = { ...item("34a", "", ""),
      materialId: "MAT-SHOWER-DC6F85FFDF14", brand: "朗格", categoryCode: "SHOWER", model: "开门 34A" };
    expect(mainMaterialShowerTypes(shower)).toEqual(["钻石型", "T型", "一固一开"]);
    expect(mainMaterialSelectionDescription(shower, "类型：钻石型｜颜色：枪灰拉丝")).toBe("开门 34A · 钻石型 · 枪灰拉丝");
    expect(mainMaterialSelectionDescription(shower, "类型：T型｜颜色：亮银")).toBe("开门 34A · T型 · 亮银");
    expect(mainMaterialSelectionDescription(shower, "亮银")).toBe("开门 34A · 亮银");
    expect(mainMaterialSelectionDescription(shower, null)).toBe("开门 34A");
    for (const other of [{ ...shower, materialId: "other" }, { ...shower, brand: "other" }]) {
      expect(mainMaterialShowerTypes(other)).toEqual([]);
      expect(mainMaterialSelectionDescription(other, "亮银")).toBe("开门 34A · 亮银");
    }
  });
  it("0920 round-trips shower type and colour, including incomplete picker states", () => {
    for (const [type, color] of [["T型", "亮银"], ["一固一开", ""], ["", "黑色"]]) {
      expect(decodeMainMaterialShowerSelection(encodeMainMaterialShowerSelection(type!, color!))).toEqual({ type, color });
    }
    expect(decodeMainMaterialShowerSelection("亮银")).toEqual({ type: "", color: "亮银" });
  });
  it.each(["M", "米", "M²", "平米", "m", "m²", "㎡", "平方"])("0920 formats %s quantities for display without modifying their value", (unit) => {
    const raw = "3.1250";
    expect(formatMainMaterialQuantity(raw, unit)).toBe("3.1");
    expect(raw).toBe("3.1250");
    expect(formatMainMaterialQuantity("2.1500", unit)).toBe("2.2");
  });
  it.each(["套", "个", "樘"])("0920 displays integer %s quantities without rounding stored values", (unit) => {
    expect(formatMainMaterialQuantity("2.1000", unit)).toBe("2");
    expect(formatMainMaterialQuantity("2.5000", unit)).toBe("3");
  });
  it("uses the renamed epoxy grout item name instead of its old generic model label", () => {
    expect(mainMaterialDisplayModel({ materialId: "MAT-SEAM-A179F09722C2", itemName: "环氧彩砂", model: "美缝" })).toBe("环氧彩砂");
    expect(mainMaterialDisplayModel({ materialId: "other", itemName: "木地板", model: "BK-01" })).toBe("BK-01");
    expect(mainMaterialDisplayModel({ materialId: "MAT-SEAM-A179F09722C2", itemName: "环氧彩砂", model: "新型号" })).toBe("新型号");
  });
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

  it("edits measured material demand but keeps tile base quantity read-only", () => {
    const tile = quotationLine("AUTO_TILE", "TILE", "50.0000", "55.7500");
    const seam = {
      ...quotationLine("MANUAL", "SEAM", null, "6.0000"),
      item: { ...item("seam", "", ""), saleUnitPrice: "25.0000", unit: "M²" },
    };

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

  it.each(["M", "米", "M²", "平米", "m", " m² ", "M2", "㎡", "平方", "平方米"])(
    "keeps loss editable for measured unit %s",
    (unit) => {
      const line = {
        ...quotationLine("MANUAL", "FLOOR", "2.0000", "2.0000"),
        item: { ...item("measured", "", ""), saleUnitPrice: "100.0000", unit },
      };
      expect(mainMaterialDemandEditing(line, true)).toEqual({ baseQuantity: true, lossRate: true });
      expect(mainMaterialDemandEditing(line, false)).toEqual({ baseQuantity: false, lossRate: false });
    },
  );

  it.each(["套", "个", "樘", "台", "片", "处", ""])(
    "makes loss read-only without changing quantity or stored values for unit %s",
    (unit) => {
      const line = {
        ...quotationLine("MANUAL", "BATHROOM", "2.0000", "2.1000"),
        item: { ...item("counted", "", ""), saleUnitPrice: "100.0000", unit },
        lossRate: "0.0500",
      };
      const before = structuredClone(line);
      expect(mainMaterialDemandEditing(line, true)).toEqual({ baseQuantity: true, lossRate: false });
      expect(line).toEqual(before);
    },
  );

  it("does not enable loss for a manual line without a selected unit", () => {
    expect(mainMaterialDemandEditing(quotationLine("MANUAL", "BATHROOM", "1", "1"), true))
      .toEqual({ baseQuantity: true, lossRate: false });
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
