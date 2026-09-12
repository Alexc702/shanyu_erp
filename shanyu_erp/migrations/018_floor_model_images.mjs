import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "18181818-1818-4818-8818-181818181818";

export async function up(pgm) {
  const baseline = await readBaselineCatalog();
  const floorItems = baseline.items.filter((item) => item.categoryCode === "FLOOR");
  const floorAssetIds = new Set(floorItems.flatMap((item) => item.assetIds));
  const floorAssets = baseline.assets.filter((asset) => floorAssetIds.has(asset.id));
  const mappings = floorItems.flatMap((item) =>
    item.assetIds.map((assetId, sortOrder) => ({ assetId, materialId: item.materialId, sortOrder })),
  );

  pgm.sql(`DO $migration$
  DECLARE
    source_catalog_id uuid;
    next_version_number integer;
  BEGIN
    SELECT id INTO source_catalog_id
      FROM main_material_catalog_versions
     WHERE status = 'PUBLISHED'
     ORDER BY version_number DESC
     LIMIT 1
     FOR UPDATE;

    IF source_catalog_id IS NULL THEN
      RAISE EXCEPTION '找不到已发布的主材库';
    END IF;
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions
      WHERE id = '${catalogId}' OR (status = 'PUBLISHED' AND source_hash = ${literal(baseline.version.sourceHash)})) THEN
      RETURN;
    END IF;

    SELECT coalesce(max(version_number), 0) + 1 INTO next_version_number
      FROM main_material_catalog_versions;
    UPDATE main_material_catalog_versions
       SET status = 'SUPERSEDED'
     WHERE id = source_catalog_id;
    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash,
       validation_report, validated_at, published_at)
    VALUES ('${catalogId}', next_version_number, ${literal(baseline.version.name)}, 'PUBLISHED',
      'BASELINE', ${literal(baseline.version.sourceFile)}, ${literal(baseline.version.sourceHash)},
      '{}'::jsonb, current_timestamp, current_timestamp);

    INSERT INTO main_material_assets
      (id, content_type, file_name, storage_path, size_bytes)
    VALUES ${floorAssets.map((asset) => `(${literal(asset.id)}, ${literal(asset.contentType)},
      ${literal(asset.fileName)}, ${literal(`main-materials/v1/images/${asset.fileName}`)}, ${Number(asset.size)})`).join(",\n")}
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
    SELECT
      (substr(md5('${catalogId}:' || material_id), 1, 8) || '-' ||
       substr(md5('${catalogId}:' || material_id), 9, 4) || '-' ||
       substr(md5('${catalogId}:' || material_id), 13, 4) || '-' ||
       substr(md5('${catalogId}:' || material_id), 17, 4) || '-' ||
       substr(md5('${catalogId}:' || material_id), 21, 12))::uuid,
      '${catalogId}', material_id, category_code, category_name,
      item_name, brand, series, model, spec, colors, unit, sale_price,
      cost_price, attributes, data_status, record_version, missing_fields,
      source_file, source_sheet, source_row, price_derivation, remarks
      FROM main_material_item_versions
     WHERE catalog_version_id = source_catalog_id
       AND category_code <> 'FLOOR';

    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
    VALUES ${floorItems.map(itemValues).join(",\n")};

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    SELECT '${catalogId}', mapping.material_id, mapping.asset_id, mapping.sort_order
      FROM main_material_item_assets mapping
      JOIN main_material_item_versions item
        ON item.catalog_version_id = mapping.catalog_version_id
       AND item.material_id = mapping.material_id
     WHERE mapping.catalog_version_id = source_catalog_id
       AND item.category_code <> 'FLOOR';

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    VALUES ${mappings.map((mapping) => `('${catalogId}', ${literal(mapping.materialId)}, ${literal(mapping.assetId)}, ${mapping.sortOrder})`).join(",\n")};

    UPDATE main_material_catalog_versions
       SET validation_report = jsonb_build_object(
         'itemCount', (SELECT count(*) FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}'),
         'activeCount', (SELECT count(*) FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}' AND data_status = 'ACTIVE'),
         'pendingCount', (SELECT count(*) FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}' AND data_status = 'PENDING_DATA'),
         'referencedImageItemCount', (SELECT count(DISTINCT material_id) FROM main_material_item_assets WHERE catalog_version_id = '${catalogId}'),
         'assetCount', (SELECT count(DISTINCT asset_id) FROM main_material_item_assets WHERE catalog_version_id = '${catalogId}')
       )
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

    IF catalog_status = 'PUBLISHED' THEN
      UPDATE main_material_catalog_versions SET status = 'DRAFT' WHERE id = '${catalogId}';
      SELECT id INTO previous_catalog_id
        FROM main_material_catalog_versions
       WHERE status = 'SUPERSEDED' AND id <> '${catalogId}'
       ORDER BY version_number DESC LIMIT 1;
      IF previous_catalog_id IS NOT NULL THEN
        UPDATE main_material_catalog_versions SET status = 'PUBLISHED' WHERE id = previous_catalog_id;
      END IF;
    ELSE
      UPDATE main_material_catalog_versions SET status = 'DRAFT' WHERE id = '${catalogId}';
    END IF;

    DELETE FROM main_material_item_assets WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_catalog_versions WHERE id = '${catalogId}';
  END
  $migration$;`);
}

function itemValues(item) {
  const attributes = {
    type: item.type,
    woodSpecies: item.woodSpecies,
    substrate: item.substrate,
    thickness: item.thickness,
    grade: item.grade,
    lockType: item.lockType,
    packaging: item.packaging,
    panelSize: item.panelSize,
    lightingPower: item.lightingPower,
    imageReference: item.imageReference,
  };
  return `('${stableUuid(`${catalogId}:${item.materialId}`)}', '${catalogId}',
    ${literal(item.materialId)}, ${literal(item.categoryCode)}, ${literal(item.categoryName)},
    ${literal(item.itemName)}, ${literal(item.brand)}, ${literal(item.series)}, ${literal(item.model)},
    ${literal(item.spec)}, ${literal(JSON.stringify(item.colors))}::jsonb, ${literal(item.unit)},
    ${nullableNumber(item.salePrice)}, ${nullableNumber(item.costPrice)},
    ${literal(JSON.stringify(attributes))}::jsonb, ${literal(item.status)}, ${Number(item.recordVersion)},
    ${literal(item.missingFields)}, ${literal(item.sourceFile)}, ${literal(item.sourceSheet)},
    ${literal(item.sourceRow)}, ${literal(item.priceDerivation)}, ${literal(item.remarks)})`;
}

function stableUuid(value) {
  const digest = createHash("sha256").update(value).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function literal(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function nullableNumber(value) {
  return value === null || value === undefined || value === "" ? "NULL" : String(value);
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
  throw new Error("找不到主材库 V1 基线资产");
}
