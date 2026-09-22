import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import type { MainMaterialItem, MainMaterialRepository } from "../main-material/main-material.repository";

export interface SelectionSheetImage {
  readonly assetId: string;
  readonly role: "product" | "color";
  readonly label: string;
}

/** Resolve the selected version and color, never the latest catalog or another variant. */
export function selectionSheetImages(item: MainMaterialItem, selected: string): readonly SelectionSheetImage[] {
  const images: SelectionSheetImage[] = [];
  const missing = () => new BadRequestException(`${item.itemName} · ${selected}：缺少对应图片，请补齐主材库图片后重新生成`);
  const add = (assetId: string | undefined, role: SelectionSheetImage["role"], label: string) => {
    if (!assetId || !item.assetIds.includes(assetId)) throw missing();
    images.push({ assetId, role, label });
  };
  const mapped = (field: string, color: string) => {
    try {
      const map = JSON.parse(item.attributes[field] ?? "{}") as Record<string, string>;
      return map[color] ?? (item.categoryCode === "SHOWER" && item.brand === "朗格" ? map[color.replaceAll("(镜面)", "（镜面）")] : undefined);
    } catch { throw missing(); }
  };
  const casing = item.materialId === "MAT-GLASS_DOOR-FBACE026D73F";
  const cabinet = item.attributes.variantGroup?.startsWith("定制浴室柜:");
  if (cabinet) {
    if (item.attributes.variantColor !== selected) throw missing();
    add(item.assetIds[0], "color", selected);
    return images;
  }
  if (!casing) add(item.assetIds[0], "product", "产品图");
  if (item.categoryCode === "GLASS_DOOR") {
    const match = /^门框：(.+)｜玻璃：(.+)$/.exec(selected);
    const frame = match?.[1] ?? (selected.startsWith("玻璃：") ? "" : selected);
    const glass = match?.[2] ?? (selected.startsWith("玻璃：") ? selected.slice(3) : "");
    if (frame) add(mapped("colorAssetMap", frame), "color", `门框：${frame}`);
    if (glass) add(mapped("glassColorAssetMap", glass), "color", `玻璃：${glass}`);
  } else if (item.attributes.colorAssetMap) {
    const color = /^类型：.+｜颜色：(.+)$/.exec(selected)?.[1] ?? selected;
    add(mapped("colorAssetMap", color), "color", color);
  } else if (item.colors.length !== 1 || item.colors[0] !== selected) {
    // A single-color variant's own product photo is authoritative; never guess for multiple colors.
    throw missing();
  }
  return images;
}

export async function readSelectionSheetImage(repository: MainMaterialRepository, id: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("选材单图片标识无效");
  const asset = await repository.findAsset(id);
  if (!asset) throw new Error(`选材单图片未登记：${id}`);
  for (const root of [resolve(process.cwd(), "apps/api/assets"), resolve(process.cwd(), "assets")]) {
    const path = resolve(root, asset.storagePath);
    if (!path.startsWith(root + sep)) throw new Error("选材单图片路径无效");
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (createHash("sha256").update(bytes).digest("hex") !== id) throw new Error(`选材单图片校验失败：${id}`);
    return sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  }
  throw new Error(`选材单图片文件不存在：${id}`);
}
