import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface BaselineItem {
  readonly assetIds: readonly string[];
  readonly brand: string;
  readonly categoryCode: string;
  readonly costPrice: string | null;
  readonly imageReference: string;
  readonly materialId: string;
  readonly model: string;
  readonly salePrice: string | null;
  readonly sourceFile: string;
  readonly sourceRow: string;
  readonly sourceSheet: string;
  readonly status: string;
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

describe("main material V1 baseline", () => {
  it("matches the approved workbook counts and only references packaged images", async () => {
    const root = resolve(process.cwd(), "assets/main-materials/v1");
    const catalog = JSON.parse(
      await readFile(resolve(root, "catalog.json"), "utf8"),
    ) as BaselineCatalog;

    expect(catalog.summary).toEqual({
      activeCount: 414,
      assetCount: 309,
      itemCount: 505,
      pendingCount: 91,
      referencedImageItemCount: 378,
    });
    expect(catalog.items).toHaveLength(505);
    expect(catalog.assets).toHaveLength(309);
    expect(
      Object.fromEntries(
        [...new Set(catalog.items.map((item) => item.categoryCode))].map((code) => [
          code,
          catalog.items.filter((item) => item.categoryCode === code).length,
        ]),
      ),
    ).toEqual({
      BATHROOM: 79,
      CEILING: 9,
      CUSTOM: 6,
      FLOOR: 56,
      GLASS_DOOR: 20,
      SEAM: 6,
      SHOWER: 6,
      STONE: 5,
      SWITCH: 1,
      TILE: 317,
    });

    const assetIds = new Set(catalog.assets.map((asset) => asset.id));
    for (const item of catalog.items) {
      for (const assetId of item.assetIds) expect(assetIds.has(assetId)).toBe(true);
    }
    for (const asset of catalog.assets) {
      const image = await stat(resolve(root, "images", asset.fileName));
      expect(image.size).toBe(asset.size);
    }
  });

  it("keeps the confirmed exclusions and does not make incomplete items selectable", async () => {
    const catalog = JSON.parse(
      await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8"),
    ) as BaselineCatalog;
    const forbiddenModels = new Set(["HX101", "HX102", "HX103", "HX104", "HX105", "HX106", "HX107"]);
    expect(catalog.items.some((item) => forbiddenModels.has(item.model))).toBe(false);
    expect(catalog.items.filter((item) => item.status === "PENDING_DATA")).toHaveLength(91);
    expect(
      catalog.items.filter((item) => item.status === "ACTIVE").every((item) =>
        Boolean(item.salePrice && item.costPrice),
      ),
    ).toBe(true);
    expect(catalog.items.every((item) => Boolean(
      item.sourceFile && item.sourceSheet && item.sourceRow,
    ))).toBe(true);
    expect(catalog.items.filter((item) => item.imageReference)).toHaveLength(378);
  });
});
