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
  readonly series: string;
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

describe("main material 0917 glass door selection baseline", () => {
  it("matches the approved workbook counts and only references packaged images", async () => {
    const root = resolve(process.cwd(), "assets/main-materials/v1");
    const catalog = JSON.parse(
      await readFile(resolve(root, "catalog.json"), "utf8"),
    ) as BaselineCatalog;

    expect(catalog.summary).toEqual({
      activeCount: 602,
      assetCount: 462,
      itemCount: 695,
      pendingCount: 89,
      referencedImageItemCount: 581,
    });
    expect(catalog.items).toHaveLength(695);
    expect(catalog.assets).toHaveLength(462);
    expect(
      Object.fromEntries(
        [...new Set(catalog.items.map((item) => item.categoryCode))].map((code) => [
          code,
          catalog.items.filter((item) => item.categoryCode === code).length,
        ]),
      ),
    ).toEqual({
      BATHROOM: 206,
      CEILING: 10,
      CUSTOM: 7,
      FLOOR: 62,
      GLASS_DOOR: 22,
      SEAM: 6,
      SHOWER: 7,
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
    expect(floorModels.filter((item) => item.model.startsWith("20K")).every((item) =>
      item.brand === "乔艺" && item.salePrice === "398.00" && item.status === "ACTIVE"
    )).toBe(true);
    expect(catalog.items.filter((item) => item.status === "PENDING_DATA")).toHaveLength(89);
    expect(catalog.items.filter((item) => item.status === "INACTIVE")).toHaveLength(4);
    expect(
      catalog.items.filter((item) => item.status === "ACTIVE").every((item) =>
        Boolean(item.salePrice && item.costPrice),
      ),
    ).toBe(true);
    expect(catalog.items.every((item) => Boolean(
      item.sourceFile && item.sourceSheet && item.sourceRow,
    ))).toBe(true);
    expect(catalog.items.filter((item) => item.assetIds.length > 0)).toHaveLength(581);
  });

  it("keeps the approved 0915 catalog values and indexed images", async () => {
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

    const glassDoors = byCategory("GLASS_DOOR");
    const glassDoorsWithProductImages = glassDoors.filter((item) =>
      item.imageReference.startsWith("xlsx://主材库/玻璃门主材库_v1.xlsx#Sheet2!row="),
    );
    const glassDoorsWithColors = glassDoors.filter((item) => item.colors.length > 0);
    expect(glassDoors).toHaveLength(22);
    expect(glassDoors.every((item) => item.brand === "铂屿定制")).toBe(true);
    expect(glassDoorsWithProductImages).toHaveLength(21);
    expect(new Set(glassDoorsWithProductImages.map((item) => item.assetIds[0])).size).toBe(10);
    expect(glassDoorsWithColors).toHaveLength(21);
    expect(glassDoorsWithColors.every((item) => {
      const colorAssetMap = JSON.parse(item.attributes.colorAssetMap ?? "{}") as Record<string, string>;
      return Object.keys(colorAssetMap).length === item.colors.length &&
        item.colors.every((color) => Boolean(colorAssetMap[color])) &&
        Object.values(colorAssetMap).every((assetId) => item.assetIds.includes(assetId));
    })).toBe(true);
    expect(glassDoors.filter((item) => item.materialId !== "MAT-GLASS_DOOR-FBACE026D73F").every((item) => {
      const glassColors = JSON.parse(item.attributes.glassColors ?? "[]") as string[];
      const glassColorAssetMap = JSON.parse(
        item.attributes.glassColorAssetMap ?? "{}",
      ) as Record<string, string>;
      return glassColors.length === 6 &&
        Object.keys(glassColorAssetMap).length === glassColors.length &&
        glassColors.every((color) => Boolean(glassColorAssetMap[color])) &&
        Object.values(glassColorAssetMap).every((assetId) => item.assetIds.includes(assetId));
    })).toBe(true);
    expect(glassDoors.filter((item) => item.colors.length === 0).map((item) => item.model)).toEqual([
      "定制玻璃",
    ]);
    const aluminumDoorCasing = glassDoors.find(
      (item) => item.materialId === "MAT-GLASS_DOOR-FBACE026D73F",
    );
    expect(aluminumDoorCasing).toMatchObject({
      assetIds: [
        "8007cff235881bb66e56aa1c155f4ca8ed690d4ff66c38a05f495754e3cb8a9f",
        "65243b9e32e7866e0d5adc1cd13b7d49ee2d484bec7b10a2463d798849b4a9e9",
        "3aaff8cb3f5b55501802743075d6bab3de1bb93915d59208a3811a92676a8263",
        "d96165e0b3b360e309b8084836851b88a664dc9da1c3520a7f7cb4577fac2e56",
        "df3371b7ecfb30a1f2ee912be80a4d64b2ae16197abb712bf1a84d638d089946",
        "64c29287d17895b8d99d186b31d1580238d6d03fe4ceb6631c0594d1ae7cbf91",
        "83f12ffc970e1a44fa31349dc3bf69573df3c4c1b86c33ec139f1c9a693e6259",
      ],
      colors: ["瓷泳黑", "瓷泳灰", "月光拉丝灰", "珐琅铜", "波光白", "米其灰", "月光灰"],
      imageReference: "",
    });
    expect(aluminumDoorCasing?.attributes.glassColors).toBeUndefined();
    expect(aluminumDoorCasing?.attributes.glassColorAssetMap).toBeUndefined();
    expect(glassDoors.map((item) => item.model)).toEqual(expect.arrayContaining([
      "偏轴门（手动预埋五金）",
      "中轴门（手动预埋五金）",
      "偏轴门（杜格铝材）",
      "中轴门（杜格铝材）",
      "偏轴门（电机预埋五金）",
      "中轴门（电机预埋五金）",
    ]));
    expect(glassDoors.filter((item) => item.itemName === "移门").map((item) => item.model)).toEqual([
      "4012三吊轨完美系统移门",
      "4012双吊轨完美系统移门",
      "4013格栅完美系统移门",
      "4503三吊轨完美系统移门（双玻）",
      "4503双吊轨完美系统移门（双玻）",
      "4516三吊轨完美系统移门",
      "4516双吊轨完美系统移门",
      "4516格栅完美系统移门",
    ]);
    expect(glassDoors.filter((item) => item.itemName === "移门").every((item) =>
      item.series === "40.45吊轨移门"
    )).toBe(true);
    expect(glassDoors.find((item) => item.materialId === "MAT-GLASS_DOOR-9405C3809DEF")?.model).toBe(
      "中轴门（杜格铝材）",
    );
    expect(glassDoors.find((item) => item.materialId === "MAT-GLASS_DOOR-A07FDDBBBF56")?.model).toBe(
      "中轴门（电机预埋五金）",
    );

    const ceiling = byCategory("CEILING");
    expect(ceiling.filter((item) => item.model.startsWith("铝扣板吊顶")).map((item) => item.model)).toEqual([
      "铝扣板吊顶暖白", "铝扣板吊顶珍珠白",
    ]);
    expect(ceiling.find((item) => item.model === "蜂窝板吊顶")?.assetIds).toHaveLength(1);
    expect(ceiling.filter((item) => [
      "蜂窝板吊顶", "铝扣板吊顶暖白", "铝扣板吊顶珍珠白",
    ].includes(item.model)).every((item) => item.unit === "M²")).toBe(true);
    expect(ceiling.filter((item) => item.itemName === "凉霸").map((item) => [
      item.attributes.panelSize, item.attributes.lightingPower,
    ])).toEqual([["300*300", ""], ["300*600", ""], ["100*667", ""]]);
    expect(ceiling.find((item) => item.model === "300H-66")?.salePrice).toBe("200.00");
    expect(ceiling.find((item) => item.itemName === "排风扇")).toMatchObject({
      assetIds: ["43eb6a4b1a9995c48016f6e40009aa5fc4d5b932a3667b080e0bb083fe11a011"],
      imageReference: "xlsx://主材库/本科吊顶_v1.xlsx#电器加灯具!row=11;count=1",
      salePrice: "200.00",
    });

    const bathroom = byCategory("BATHROOM");
    const cabinets = bathroom.filter((item) =>
      item.attributes.variantGroup?.startsWith("定制浴室柜:"),
    );
    expect(cabinets).toHaveLength(120);
    expect(cabinets.every((item) => item.brand === "铂屿定制")).toBe(true);
    expect(new Set(cabinets.map((item) => item.model))).toEqual(new Set([
      "免漆浴室柜（主卫）",
      "免漆浴室柜（公卫）",
      "烤漆浴室柜（主卫）",
      "烤漆浴室柜（公卫）",
    ]));
    expect(new Set(cabinets.map((item) => item.attributes.variantGroup)).size).toBe(4);
    expect(cabinets.every((item) => item.colors[0] === item.attributes.variantColor)).toBe(true);
    const delifengColors = cabinets.filter((item) => {
      const sourceRow = Number(item.sourceRow);
      return sourceRow >= 2 && sourceRow <= 15;
    });
    expect(delifengColors).toHaveLength(56);
    expect(delifengColors.every((item) => item.colors[0]?.startsWith("德利丰（大板）-"))).toBe(true);
    expect(Object.fromEntries([25, 27, 29].map((sourceRow) => [
      sourceRow,
      [...new Set(cabinets.filter((item) => Number(item.sourceRow) === sourceRow)
        .flatMap((item) => item.assetIds))],
    ]))).toEqual({
      25: ["f26ceae78140417fe6914ba192e6c68f97c097272b336f105d872a6c2fcf4ca8"],
      27: ["f9819e1af67ead95532385f7f1c844b0fc5cb97f12c535c7cc9caf7751710af1"],
      29: ["4cc1c285d450282d3c676962c5e5beee4ca2a0d69057086fa210196e51da177a"],
    });
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
    expect(bathroom.filter((item) => item.brand === "顾朗")).toHaveLength(76);
    expect(bathroom.filter((item) => item.brand === "顾朗").every((item) => item.assetIds.length >= 1)).toBe(true);
    expect(bathroom.filter((item) => item.model === "L-8560").map((item) => item.colors[0]).sort()).toEqual([
      "拉丝玫瑰金", "拉丝金", "铬色",
    ].sort());
    expect(bathroom.find((item) => item.materialId === "MAT-BATHROOM-CA0F9C7F63E6")?.model).toBe(
      "全智能马桶 FSN0320D-G",
    );
    expect([
      "MAT-BATHROOM-C4DA5BD71DE9",
      "MAT-BATHROOM-539488A9C0DD",
      "MAT-BATHROOM-D22F2F4E8983",
      "MAT-BATHROOM-67C264B2952F",
    ].map((materialId) => bathroom.find((item) => item.materialId === materialId)?.model)).toEqual([
      "轻智能马桶 60006",
      "轻智能马桶 22478007",
      "壁挂马桶 FLG3116S",
      "轻智能马桶 FLP0834D",
    ]);

    const shower = byCategory("SHOWER").filter((item) => item.brand === "朗格");
    expect(shower).toHaveLength(6);
    expect(shower.every((item) => item.assetIds.length === 14 && item.colors.length === 13)).toBe(true);
    expect(shower.every((item) => Object.keys(JSON.parse(item.attributes.colorAssetMap ?? "{}")).length === 13)).toBe(true);
    expect(shower.map((item) => [item.itemName, item.model])).toEqual([
      ["移门系列", "移门 21AT"],
      ["开门系列", "开门 36B"],
      ["开门系列", "开门 39AT"],
      ["移门系列", "移门 46A"],
      ["开门系列", "开门 34A"],
      ["移门系列", "移门 41A"],
    ]);
    expect(new Set(shower.map((item) => item.assetIds[0])).size).toBe(6);

    const stone = byCategory("STONE");
    expect(stone).toHaveLength(53);
    expect(stone.filter((item) => item.assetIds.length)).toHaveLength(50);
    expect(stone.filter((item) => item.itemName === "人造石")).toHaveLength(6);
    expect(stone.filter((item) => item.itemName === "人造石").every((item) => item.brand === "人造石")).toBe(true);
    expect(stone.filter((item) => item.itemName === "天然大理石")).toHaveLength(1);
    expect(stone.find((item) => item.itemName === "天然大理石")?.brand).toBe("天然大理石");
    expect(stone.filter((item) => /^\d/.test(item.spec)).every((item) =>
      item.spec.endsWith("（宽度不超过80cm）")
    )).toBe(true);
    expect(stone.filter((item) => item.brand === "德利丰" && item.spec.startsWith("1200*2700*6")).every((item) =>
      item.model.startsWith("德利丰（小板）")
    )).toBe(true);
    expect(stone.filter((item) => item.brand === "德利丰" && item.spec.startsWith("1600*3200*12")).every((item) =>
      item.model.startsWith("德利丰（大板）")
    )).toBe(true);
    expect(byCategory("SWITCH")).toHaveLength(5);
    expect(byCategory("SWITCH").every((item) => item.assetIds.length === 1)).toBe(true);
  });
});
