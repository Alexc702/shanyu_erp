import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeCabinetVariant } from "../src/main-material/main-material-cabinet-mapping";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";

describe("custom bathroom cabinet mapping", () => {
  it.each([
    "免漆浴室柜（主卫）", "免漆浴室柜（公卫）",
    "烤漆浴室柜（主卫）", "烤漆浴室柜（公卫）",
  ])("maps the core material to a colour under %s without changing cabinet prices", (itemName) => {
    const source = cabinet({ itemName });
    const result = normalizeCabinetVariant(source);
    expect(result).toEqual({
      ...source,
      model: itemName,
      colors: ["德利丰（大板）-洞石米白"],
      attributes: {
        ...source.attributes,
        variantGroup: `定制浴室柜:${itemName}`,
        variantColor: "德利丰（大板）-洞石米白",
      },
    });
  });

  it("preserves an approved label by material_id when the source row moves", () => {
    const previous = normalizeCabinetVariant(cabinet());
    const source = cabinet({ model: "洞石米白", sourceRow: "97" });
    expect(normalizeCabinetVariant(source, previous)).toMatchObject({
      materialId: source.materialId,
      model: source.itemName,
      sourceRow: "97",
      colors: previous.colors,
      attributes: previous.attributes,
    });
    const otherMaterial = { ...previous, materialId: "MAT-BATHROOM-OTHER" };
    expect(normalizeCabinetVariant(source, otherMaterial).colors).toEqual(["洞石米白"]);
  });

  it("updates variantColor when the selected core material colour is edited", () => {
    const previous = normalizeCabinetVariant(cabinet());
    const result = normalizeCabinetVariant({ ...previous, colors: ["蓝水晶"] }, previous);
    expect(result.colors).toEqual(["蓝水晶"]);
    expect(result.attributes.variantColor).toBe("蓝水晶");
    expect(result.attributes.variantGroup).toBe(previous.attributes.variantGroup);
    expect(result.salePrice).toBe(previous.salePrice);
    expect(result.costPrice).toBe(previous.costPrice);
  });

  it("leaves unrelated materials untouched and does not infer mappings from source rows", () => {
    const source = cabinet({ itemName: "龙头", model: "L-4381" });
    expect(normalizeCabinetVariant(source)).toBe(source);
    const stone = cabinet({ categoryCode: "STONE" });
    expect(normalizeCabinetVariant(stone)).toBe(stone);
  });

  it.each([{ colors: [] }, { colors: ["洞石米白", "蓝水晶"] }])("rejects ambiguous cabinet colour options: $colors", ({ colors }) => {
    expect(() => normalizeCabinetVariant(cabinet({ colors }))).toThrow("每条定制浴室柜记录必须对应一个核心主材颜色");
  });

  it("keeps all 120 published variants, four groups and their asset identities unchanged", async () => {
    const baseline = JSON.parse(await readFile(
      resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8",
    )) as { items: (NormalizedMainMaterialItem & { assetIds: string[] })[] };
    const sources = baseline.items.filter((item) => item.attributes.variantGroup?.startsWith("定制浴室柜:"));
    expect(sources).toHaveLength(120);
    const mapped = sources.map((item) => normalizeCabinetVariant(item));
    expect(mapped).toEqual(sources);
    expect(new Set(mapped.map((item) => item.attributes.variantGroup)).size).toBe(4);
    expect(mapped.map((item) => normalizeCabinetVariant(item))).toEqual(mapped);
  });
});

function cabinet(overrides: Partial<NormalizedMainMaterialItem> = {}): NormalizedMainMaterialItem {
  return {
    materialId: "MAT-BATHROOM-DD50EBFFF7E0",
    categoryCode: "BATHROOM",
    categoryName: "卫浴",
    itemName: "免漆浴室柜（主卫）",
    brand: "铂屿定制",
    series: "哑光",
    model: "德利丰-洞石米白",
    spec: "1600*3200*12",
    colors: ["洞石米白"],
    unit: "M",
    salePrice: "4500.00",
    costPrice: "2800.00",
    attributes: { imageReference: "xlsx://主材库/定制浴室柜主材库_v1.xlsx#Sheet1!row=2;count=1" },
    status: "ACTIVE",
    recordVersion: 4,
    missingFields: "",
    sourceFile: "主材库/定制浴室柜主材库_v1.xlsx",
    sourceSheet: "Sheet1",
    sourceRow: "2",
    remarks: "整柜按米收费",
    ...overrides,
  };
}
