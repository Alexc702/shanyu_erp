import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface BaselineItem {
  readonly assetIds: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly brand: string;
  readonly categoryCode: string;
  readonly colors: readonly string[];
  readonly costPrice: string | null;
  readonly imageReference: string;
  readonly itemName: string;
  readonly materialId: string;
  readonly model: string;
  readonly salePrice: string | null;
  readonly sourceFile: string;
  readonly sourceRow: string;
  readonly sourceSheet: string;
  readonly spec: string;
  readonly status: string;
  readonly unit: string;
}

interface BaselineCatalog {
  readonly assets: readonly { readonly fileName: string; readonly id: string; readonly size: number }[];
  readonly items: readonly BaselineItem[];
  readonly summary: {
    readonly activeCount: number;
    readonly assetCount: number;
    readonly itemCount: number;
    readonly pendingCount: number;
    readonly referencedImageItemCount: number;
  };
}

describe("main material 0911 baseline", () => {
  it("matches the approved workbook counts and only references packaged images", async () => {
    const root = resolve(process.cwd(), "assets/main-materials/v1");
    const catalog = JSON.parse(
      await readFile(resolve(root, "catalog.json"), "utf8"),
    ) as BaselineCatalog;

    expect(catalog.summary).toEqual({
      activeCount: 589,
      assetCount: 437,
      itemCount: 690,
      pendingCount: 97,
      referencedImageItemCount: 573,
    });
    expect(catalog.items).toHaveLength(690);
    expect(catalog.assets).toHaveLength(437);
    expect(
      Object.fromEntries(
        [...new Set(catalog.items.map((item) => item.categoryCode))].map((code) => [
          code,
          catalog.items.filter((item) => item.categoryCode === code).length,
        ]),
      ),
    ).toEqual({
      BATHROOM: 204,
      CEILING: 10,
      CUSTOM: 7,
      FLOOR: 62,
      GLASS_DOOR: 20,
      SEAM: 6,
      SHOWER: 6,
      STONE: 53,
      SWITCH: 5,
      TILE: 317,
    });

    const assetIds = new Set(catalog.assets.map((asset) => asset.id));
    for (const item of catalog.items) {
      expect(new Set(item.assetIds).size).toBe(item.assetIds.length);
      for (const assetId of item.assetIds) expect(assetIds.has(assetId)).toBe(true);
    }
    for (const asset of catalog.assets) {
      const image = await stat(resolve(root, "images", asset.fileName));
      expect(image.size).toBe(asset.size);
    }
  });

  it("keeps every floor model separate with its matching image and does not make incomplete items selectable", async () => {
    const catalog = JSON.parse(
      await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8"),
    ) as BaselineCatalog;
    const expectedFloorModels = [
      "BK-01", "BK-02", "BK-03", "BK-04", "BK-05", "BK-06", "BK-07", "BK-08",
      "HX101", "HX102", "HX103", "HX104", "HX105", "HX106", "HX107",
      "HD201", "HD202", "HD203", "HD204", "HD205",
      "HT201", "HT202", "HT203", "HT204", "HT205", "HT206", "HT207",
      "F01", "F02", "F03", "F04", "F05", "F06", "F07",
      "20K31", "20K32", "20K33", "20K35", "20K36", "20K37", "20K38", "20K39",
      "20R11", "20R12", "20R13", "20R15", "20R16", "20R17", "20R18", "20R19",
    ];
    const floorModels = catalog.items.filter((item) =>
      item.categoryCode === "FLOOR" && item.itemName === "木地板",
    );
    expect(floorModels.map((item) => item.model).sort()).toEqual(expectedFloorModels.sort());
    expect(new Set(floorModels.map((item) => item.materialId).filter(Boolean)).size).toBe(50);
    expect(floorModels.every((item) => item.assetIds.length === 1)).toBe(true);
    expect(new Set(floorModels.flatMap((item) => item.assetIds)).size).toBe(50);
    expect(floorModels.every((item) =>
      item.imageReference.startsWith("xlsx://主材库/地板主材库_v1.xlsx#地板型号索引!row=")
    )).toBe(true);
    expect(catalog.items.filter((item) => item.status === "PENDING_DATA")).toHaveLength(97);
    expect(catalog.items.filter((item) => item.status === "INACTIVE")).toHaveLength(4);
    expect(
      catalog.items.filter((item) => item.status === "ACTIVE").every((item) =>
        Boolean(item.salePrice && item.costPrice),
      ),
    ).toBe(true);
    expect(catalog.items.every((item) => Boolean(
      item.sourceFile && item.sourceSheet && item.sourceRow,
    ))).toBe(true);
    expect(catalog.items.filter((item) => item.imageReference)).toHaveLength(573);
  });

  it("keeps the approved 0911 catalog values and indexed images", async () => {
    const catalog = JSON.parse(
      await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8"),
    ) as BaselineCatalog;
    const byCategory = (code: string) => catalog.items.filter((item) => item.categoryCode === code);

    expect(byCategory("SEAM").map((item) => [item.brand, item.spec])).toEqual(
      expect.arrayContaining([
        ["梵聚匠/汉高百得", "规格100x100mm / 200x200mm / 50x200mm / 60x200mm"],
        ["梵聚匠/汉高百得", "规格600x1200mm / 750x1500mm"],
      ]),
    );

    const floor = byCategory("FLOOR");
    expect(floor.filter((item) => item.itemName === "木地板")).toHaveLength(50);
    expect(floor.filter((item) => item.itemName !== "木地板").every((item) => item.brand === "辅材")).toBe(true);
    expect(floor.some((item) => item.itemName.includes("点胶"))).toBe(false);
    expect(floor.find((item) => item.itemName === "满胶铺贴")?.salePrice).toBe("120.00");

    const ceiling = byCategory("CEILING");
    expect(ceiling.filter((item) => item.model.startsWith("铝扣板吊顶")).map((item) => item.model)).toEqual([
      "铝扣板吊顶暖白", "铝扣板吊顶珍珠白",
    ]);
    expect(ceiling.find((item) => item.model === "蜂窝板吊顶")?.assetIds).toHaveLength(1);
    expect(ceiling.filter((item) => item.itemName === "凉霸").map((item) => [
      item.attributes.panelSize, item.attributes.lightingPower,
    ])).toEqual([["300*300", ""], ["300*600", ""], ["100*667", ""]]);

    const bathroom = byCategory("BATHROOM");
    const cabinets = bathroom.filter((item) =>
      item.attributes.variantGroup?.startsWith("定制浴室柜:"),
    );
    expect(cabinets).toHaveLength(120);
    expect(cabinets.every((item) => item.brand === "德利丰")).toBe(true);
    expect(new Set(cabinets.map((item) => item.model))).toEqual(new Set([
      "免漆浴室柜（主卫）",
      "免漆浴室柜（公卫）",
      "烤漆浴室柜（主卫）",
      "烤漆浴室柜（公卫）",
    ]));
    expect(new Set(cabinets.map((item) => item.attributes.variantGroup)).size).toBe(4);
    expect(cabinets.every((item) => item.colors[0] === item.attributes.variantColor)).toBe(true);
    expect(Object.fromEntries([
      "MAT-BATHROOM-B529657C0264",
      "MAT-BATHROOM-DC20B75812EF",
      "MAT-BATHROOM-C4DA5BD71DE9",
      "MAT-BATHROOM-1165182E1333",
      "MAT-BATHROOM-67C264B2952F",
      "MAT-BATHROOM-D22F2F4E8983",
      "MAT-BATHROOM-539488A9C0DD",
    ].map((materialId) => [
      materialId,
      bathroom.find((item) => item.materialId === materialId)?.assetIds,
    ]))).toEqual({
      "MAT-BATHROOM-B529657C0264": ["ed1fce1dd20a96d2ac907e112eda2ab949d7ed0c179bbfe25b97303fd5c88ce1"],
      "MAT-BATHROOM-DC20B75812EF": ["eaa1f9c245abfb03794f3fcf6a5434fc499365a8f2d5d0d4937e81b796a31e6e"],
      "MAT-BATHROOM-C4DA5BD71DE9": ["154c4ec627dc8d7d5399963ab7860a93df9c7eb4a6d92d8f8a3e6f934faf62da"],
      "MAT-BATHROOM-1165182E1333": ["7d18d004cc4de4281db40e48bf7047434c61df0275e0d6f804c4b1f73c0d61df"],
      "MAT-BATHROOM-67C264B2952F": ["398d829b1ff8b346e9c32d8ba6946708351d99a1debadea0f8c4212957beaa3e"],
      "MAT-BATHROOM-D22F2F4E8983": ["28fa52108e631c5ec0c8b51b2b5dd179c7d3a3a833df1d6488e85e86709358ad"],
      "MAT-BATHROOM-539488A9C0DD": ["0e5b59a0436d4ce2d0ff378eb70b171f8bd39b65d0246b7bbdfc4405f18708f3"],
    });
    expect(bathroom.filter((item) => item.brand === "顾朗")).toHaveLength(75);
    expect(bathroom.filter((item) => item.brand === "顾朗").every((item) => item.assetIds.length >= 1)).toBe(true);

    const shower = byCategory("SHOWER").filter((item) => item.brand === "朗格");
    expect(shower).toHaveLength(5);
    expect(shower.every((item) => item.assetIds.length === 14 && item.colors.length === 13)).toBe(true);
    expect(shower.every((item) => Object.keys(JSON.parse(item.attributes.colorAssetMap ?? "{}")).length === 13)).toBe(true);

    const stone = byCategory("STONE");
    expect(stone).toHaveLength(53);
    expect(stone.filter((item) => item.assetIds.length)).toHaveLength(50);
    expect(stone.filter((item) => item.itemName === "人造石")).toHaveLength(6);
    expect(stone.filter((item) => item.itemName === "人造石").every((item) => item.brand === "人造石")).toBe(true);
    expect(stone.filter((item) => item.itemName === "天然大理石")).toHaveLength(1);
    expect(stone.find((item) => item.itemName === "天然大理石")?.brand).toBe("天然大理石");
    expect(byCategory("SWITCH")).toHaveLength(5);
    expect(byCategory("SWITCH").every((item) => item.assetIds.length === 1)).toBe(true);
  });
});
