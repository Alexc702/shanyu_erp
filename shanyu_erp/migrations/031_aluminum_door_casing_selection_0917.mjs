import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "31313131-3131-4131-8131-313131313131";
const materialId = "MAT-GLASS_DOOR-FBACE026D73F";

export async function up(pgm) {
  const baseline = await readBaselineCatalog();
  const item = baseline.items.find((candidate) => candidate.materialId === materialId);
  if (!item) throw new Error("找不到铝合金门套主材记录");
  if (
    item.imageReference ||
    item.colors.length !== 7 ||
    item.attributes.glassColors ||
    item.attributes.glassColorAssetMap ||
    item.assetIds.length !== 7
  ) {
    throw new Error("铝合金门套的主图或门框颜色基线不完整");
  }

  const assets = baseline.assets.filter((asset) => item.assetIds.includes(asset.id));
  if (assets.length !== item.assetIds.length) {
    throw new Error("铝合金门套的门框色卡资产不完整");
  }

  const assetIds = item.assetIds.map(literal).join(", ");
  const mappings = item.assetIds
    .map((assetId, sortOrder) => `('${catalogId}', ${literal(materialId)}, ${literal(assetId)}, ${sortOrder})`)
    .join(",\n");

  pgm.sql(`DO $migration$
  DECLARE
    source_catalog_id uuid;
    next_version_number integer;
    copied_target_count integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions WHERE id = '${catalogId}') THEN
      RETURN;
    END IF;

    SELECT id INTO source_catalog_id
      FROM main_material_catalog_versions
     WHERE status = 'PUBLISHED'
     ORDER BY version_number DESC
     LIMIT 1
     FOR UPDATE;
    IF source_catalog_id IS NULL THEN
      RAISE EXCEPTION '找不到已发布的主材库';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM main_material_item_versions current_item
       WHERE current_item.catalog_version_id = source_catalog_id
         AND current_item.material_id = ${literal(materialId)}
         AND current_item.colors = ${literal(JSON.stringify(item.colors))}::jsonb
         AND current_item.attributes = ${literal(JSON.stringify(item.attributes))}::jsonb
         AND current_item.record_version = ${Number(item.recordVersion)}
         AND current_item.remarks = ${literal(item.remarks)}
         AND (SELECT count(*)
                FROM main_material_item_assets mapping
               WHERE mapping.catalog_version_id = source_catalog_id
                 AND mapping.material_id = ${literal(materialId)}) = ${item.assetIds.length}
         AND NOT EXISTS (
           SELECT 1
             FROM main_material_item_assets mapping
            WHERE mapping.catalog_version_id = source_catalog_id
              AND mapping.material_id = ${literal(materialId)}
              AND mapping.asset_id NOT IN (${assetIds})
         )
    ) THEN
      RETURN;
    END IF;

    SELECT coalesce(max(version_number), 0) + 1 INTO next_version_number
      FROM main_material_catalog_versions;

    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash,
       validation_report, validated_at, published_at)
    SELECT '${catalogId}', next_version_number,
           '山屿 ERP 主材库 0917 铝合金门套选型修正版', 'DRAFT',
           source_type, source_file, source_hash,
           coalesce(validation_report, '{}'::jsonb) ||
             jsonb_build_object('aluminumDoorCasingFrameColors', ${item.colors.length}),
           NULL, NULL
      FROM main_material_catalog_versions
     WHERE id = source_catalog_id;

    INSERT INTO main_material_assets
      (id, content_type, file_name, storage_path, size_bytes)
    VALUES ${assets.map((asset) => `(${literal(asset.id)}, ${literal(asset.contentType)},
      ${literal(asset.fileName)}, ${literal(`main-materials/v1/images/${asset.fileName}`)}, ${Number(asset.size)})`).join(",\n")}
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
    SELECT gen_random_uuid(), '${catalogId}', material_id, category_code, category_name,
           item_name, brand, series, model, spec, colors, unit, sale_price,
           cost_price, attributes, data_status, record_version, missing_fields,
           source_file, source_sheet, source_row, price_derivation, remarks
      FROM main_material_item_versions
     WHERE catalog_version_id = source_catalog_id;

    UPDATE main_material_item_versions
       SET colors = ${literal(JSON.stringify(item.colors))}::jsonb,
           attributes = ${literal(JSON.stringify(item.attributes))}::jsonb,
           record_version = ${Number(item.recordVersion)},
           remarks = ${literal(item.remarks)}
     WHERE catalog_version_id = '${catalogId}'
       AND material_id = ${literal(materialId)};

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    SELECT '${catalogId}', mapping.material_id, mapping.asset_id, mapping.sort_order
      FROM main_material_item_assets mapping
     WHERE mapping.catalog_version_id = source_catalog_id
       AND mapping.material_id <> ${literal(materialId)};

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    VALUES ${mappings};
    GET DIAGNOSTICS copied_target_count = ROW_COUNT;
    IF copied_target_count <> ${item.assetIds.length} THEN
      RAISE EXCEPTION '铝合金门套门框色卡复制数量异常：%', copied_target_count;
    END IF;

    UPDATE main_material_catalog_versions SET status = 'SUPERSEDED'
     WHERE id = source_catalog_id;
    UPDATE main_material_catalog_versions
       SET status = 'PUBLISHED', validated_at = current_timestamp,
           published_at = current_timestamp
     WHERE id = '${catalogId}';
  END
  $migration$;`);
}

export async function down(pgm) {
  pgm.sql(`DO $migration$
  DECLARE
    catalog_status text;
    previous_catalog_id uuid;
  BEGIN
    SELECT status INTO catalog_status FROM main_material_catalog_versions WHERE id = '${catalogId}';
    IF catalog_status IS NULL THEN RETURN; END IF;

    SELECT id INTO previous_catalog_id
      FROM main_material_catalog_versions
     WHERE status = 'SUPERSEDED' AND id <> '${catalogId}'
     ORDER BY version_number DESC LIMIT 1;
    UPDATE main_material_catalog_versions SET status = 'DRAFT' WHERE id = '${catalogId}';
    IF catalog_status = 'PUBLISHED' AND previous_catalog_id IS NOT NULL THEN
      UPDATE main_material_catalog_versions SET status = 'PUBLISHED'
       WHERE id = previous_catalog_id;
    END IF;

    IF previous_catalog_id IS NOT NULL THEN
      UPDATE main_material_quote_lines line
         SET item_version_id = previous_item.id
        FROM main_material_item_versions current_item,
             main_material_item_versions previous_item,
             half_package_quotations quotation
       WHERE quotation.main_material_catalog_version_id = '${catalogId}'
         AND line.quotation_id = quotation.id
         AND current_item.id = line.item_version_id
         AND previous_item.catalog_version_id = previous_catalog_id
         AND previous_item.material_id = current_item.material_id;
      UPDATE half_package_quotations
         SET main_material_catalog_version_id = previous_catalog_id
       WHERE main_material_catalog_version_id = '${catalogId}';
    END IF;

    DELETE FROM main_material_item_assets WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_catalog_versions WHERE id = '${catalogId}';
  END
  $migration$;`);
}

function literal(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

async function readBaselineCatalog() {
  const candidates = [
    resolve(process.cwd(), "apps/api/assets/main-materials/v1/catalog.json"),
    resolve(process.cwd(), "assets/main-materials/v1/catalog.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("找不到铝合金门套选型修正版主材资产");
}
