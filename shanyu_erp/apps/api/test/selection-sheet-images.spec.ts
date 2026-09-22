import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { readSelectionSheetImage } from "../src/quotation/selection-sheet-images";
import type { MainMaterialRepository, MainMaterialAsset } from "../src/main-material/main-material.repository";

const root = resolve(process.cwd(), "assets");
async function fixture() {
  const catalog = JSON.parse(await readFile(resolve(root, "main-materials/v1/catalog-0919.json"), "utf8")) as { assets: MainMaterialAsset[] };
  const source = catalog.assets.find(asset => asset.contentType === "image/webp")!;
  const asset = { ...source, storagePath: `main-materials/v1/images/${source.fileName}` };
  const repo = { findAsset: async () => asset } as unknown as MainMaterialRepository;
  return { asset, repo };
}
describe("selection sheet real image loader", () => {
  it("verifies content hash and converts the catalog WebP to a printable PNG", async () => {
    const { asset, repo } = await fixture();
    const original = await readFile(resolve(root, asset.storagePath));
    expect(createHash("sha256").update(original).digest("hex")).toBe(asset.id);
    const png = await readSelectionSheetImage(repo, asset.id);
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe("png");
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(900);
  });
  it("refuses mismatched image bytes and unknown asset IDs", async () => {
    const { repo } = await fixture();
    await expect(readSelectionSheetImage(repo, "0".repeat(64))).rejects.toThrow("校验失败");
    await expect(readSelectionSheetImage({ findAsset: async () => null } as unknown as MainMaterialRepository, "0".repeat(64))).rejects.toThrow("未登记");
  });
  it("refuses path traversal and missing files without external fetches", async () => {
    const { asset } = await fixture();
    const repo = (storagePath: string) => ({ findAsset: async () => ({ ...asset, storagePath }) }) as unknown as MainMaterialRepository;
    await expect(readSelectionSheetImage(repo("../.env"), asset.id)).rejects.toThrow("路径无效");
    await expect(readSelectionSheetImage(repo("main-materials/missing-test-image.png"), asset.id)).rejects.toThrow("文件不存在");
  });
});
