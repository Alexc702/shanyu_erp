import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "30303030-3030-4030-8030-303030303030";
const sourceFile = "主材库/定制浴室柜主材库_v1.xlsx";
const correctedRows = new Set(["25", "27", "29"]);

export async function up(pgm) {
  const baseline = await readBaselineCatalog();
  const expectedMappings = baseline.items
    .filter(
      (item) => item.sourceFile === sourceFile && correctedRows.has(item.sourceRow),
    )
    .map((item) => ({ assetId: item.assetIds[0], materialId: item.materialId }));

  if (
    expectedMappings.length !== 12 ||
    expectedMappings.some((mapping) => !mapping.assetId)
  ) {
    throw new Error("定制浴室柜第 25、27、29 行图片映射不完整");
  }

  const correctedAssetIds = [...new Set(expectedMappings.map(({ assetId }) => assetId))];
  const correctedAssets = baseline.assets.filter((asset) =>
    correctedAssetIds.includes(asset.id),
  );
  if (correctedAssets.length !== 3) {
    throw new Error("定制浴室柜第 25、27、29 行图片资产不完整");
  }

  const expectedValues = expectedMappings
    .map(({ assetId, materialId }) => `(${literal(materialId)}, ${literal(assetId)})`)
    .join(",\n");

  pgm.sql(`DO $migration$
  DECLARE
    source_catalog_id uuid;
    next_version_number integer;
    correct_mapping_count integer;
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

    WITH expected(material_id, asset_id) AS (VALUES ${expectedValues})
    SELECT count(*) INTO correct_mapping_count
      FROM expected
      JOIN main_material_item_versions item
        ON item.catalog_version_id = source_catalog_id
       AND item.material_id = expected.material_id
     WHERE (SELECT count(*)
              FROM main_material_item_assets mapping
             WHERE mapping.catalog_version_id = source_catalog_id
               AND mapping.material_id = expected.material_id) = 1
       AND EXISTS (
         SELECT 1
           FROM main_material_item_assets mapping
          WHERE mapping.catalog_version_id = source_catalog_id
            AND mapping.material_id = expected.material_id
            AND mapping.asset_id = expected.asset_id
       );
    IF correct_mapping_count = 12 THEN
      RETURN;
    END IF;

    SELECT coalesce(max(version_number), 0) + 1 INTO next_version_number
      FROM main_material_catalog_versions;
    UPDATE main_material_catalog_versions SET status = 'SUPERSEDED'
     WHERE id = source_catalog_id;

    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash,
       validation_report, validated_at, published_at)
    SELECT '${catalogId}', next_version_number,
           '山屿 ERP 主材库 0917 定制浴室柜图片修正版', 'PUBLISHED',
           source_type, source_file, source_hash,
           coalesce(validation_report, '{}'::jsonb) ||
             jsonb_build_object('customBathroomCabinetImageFix', 12),
           current_timestamp, current_timestamp
      FROM main_material_catalog_versions
     WHERE id = source_catalog_id;

    INSERT INTO main_material_assets
      (id, content_type, file_name, storage_path, size_bytes)
    VALUES ${correctedAssets.map((asset) => `(${literal(asset.id)}, ${literal(asset.contentType)},
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

    WITH expected(material_id, asset_id) AS (VALUES ${expectedValues})
    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    SELECT '${catalogId}', mapping.material_id, mapping.asset_id, mapping.sort_order
      FROM main_material_item_assets mapping
     WHERE mapping.catalog_version_id = source_catalog_id
       AND NOT EXISTS (
         SELECT 1 FROM expected WHERE expected.material_id = mapping.material_id
       );

    WITH expected(material_id, asset_id) AS (VALUES ${expectedValues})
    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    SELECT '${catalogId}', expected.material_id, expected.asset_id, 0
      FROM expected
      JOIN main_material_item_versions item
        ON item.catalog_version_id = '${catalogId}'
       AND item.material_id = expected.material_id;
    GET DIAGNOSTICS copied_target_count = ROW_COUNT;
    IF copied_target_count <> 12 THEN
      RAISE EXCEPTION '定制浴室柜图片映射复制数量异常：%', copied_target_count;
    END IF;
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
      UPDATE main_material_quote_lines line
         SET item_version_id = NULL, material_id = NULL, item_name = NULL,
             brand = NULL, series = NULL, model = NULL, spec = NULL,
             selected_color = NULL, unit = NULL, sale_unit_price = NULL,
             cost_unit_price = NULL, sale_amount = NULL, cost_amount = NULL,
             asset_ids = '[]'::jsonb
        FROM half_package_quotations quotation
       WHERE quotation.main_material_catalog_version_id = '${catalogId}'
         AND line.quotation_id = quotation.id
         AND line.item_version_id IN (
           SELECT current_item.id
             FROM main_material_item_versions current_item
            WHERE current_item.catalog_version_id = '${catalogId}'
              AND NOT EXISTS (
                SELECT 1 FROM main_material_item_versions previous_item
                 WHERE previous_item.catalog_version_id = previous_catalog_id
                   AND previous_item.material_id = current_item.material_id
              )
         );
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
  throw new Error("找不到定制浴室柜图片修正版主材资产");
}
