import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const materialId = "MAT-SHOWER-DC6F85FFDF14";
const oldImage = "547f7108b0fc470f638bdb35cb6db252621ea2a0417b7b4d57a18a5768776029";
const newImage = "b81f83d09bc071504448c4d6f5a9dae0c2b0770ced1aad8292a6ef374a579766";
const storagePath = `main-materials/v1/images/${newImage}.png`;

export async function up(pgm) {
  let image;
  for (const root of ["apps/api/assets", "assets"]) {
    try {
      image = await readFile(resolve(process.cwd(), root, storagePath));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!image || createHash("sha256").update(image).digest("hex") !== newImage) {
    throw new Error("34A 新主图缺失或 SHA-256 不一致，停止迁移");
  }
  // Explicitly authorized image-only correction, including historical versions.
  // Migration transaction/table locks keep the temporary trigger bypass isolated.
  pgm.sql(`
    LOCK TABLE main_material_item_assets, main_material_quote_lines IN ACCESS EXCLUSIVE MODE;
    INSERT INTO main_material_assets (id, content_type, file_name, storage_path, size_bytes)
      VALUES ('${newImage}', 'image/png', '${newImage}.png', '${storagePath}', ${image.length})
      ON CONFLICT (id) DO NOTHING;
    ALTER TABLE main_material_item_assets DISABLE TRIGGER main_material_item_assets_immutable;
    ALTER TABLE main_material_quote_lines DISABLE TRIGGER main_material_quote_lines_immutable;

    DELETE FROM main_material_item_assets
      WHERE material_id = '${materialId}' AND asset_id IN ('${oldImage}', '${newImage}');
    INSERT INTO main_material_item_assets (catalog_version_id, material_id, asset_id, sort_order)
      SELECT catalog_version_id, material_id, '${newImage}', 0
      FROM main_material_item_versions WHERE material_id = '${materialId}';
    UPDATE main_material_quote_lines line SET asset_ids =
      jsonb_build_array('${newImage}'::text) || coalesce((
        SELECT jsonb_agg(value ORDER BY ordinal)
        FROM jsonb_array_elements(line.asset_ids) WITH ORDINALITY AS assets(value, ordinal)
        WHERE value #>> '{}' NOT IN ('${oldImage}', '${newImage}')
      ), '[]'::jsonb)
      WHERE material_id = '${materialId}';

    ALTER TABLE main_material_item_assets ENABLE TRIGGER main_material_item_assets_immutable;
    ALTER TABLE main_material_quote_lines ENABLE TRIGGER main_material_quote_lines_immutable;
  `);
}

export async function down() {
  throw new Error("34A 全量图片替换不可自动回退；如需恢复请使用迁移前备份");
}
