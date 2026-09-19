import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "32323232-3232-4232-8232-323232323232";
const previousSourceHash = "de4429313900a87943be5643266f8936c45e878a8d9ba77c963857a7633268ec";

export async function up(pgm) {
  const baseline = await readBaselineCatalog();
  pgm.sql(`DO $migration$
  DECLARE source_id uuid; source_hash_value text; next_version integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions WHERE id = '${catalogId}') THEN RETURN; END IF;
    SELECT id, source_hash INTO source_id, source_hash_value
      FROM main_material_catalog_versions WHERE status = 'PUBLISHED' FOR UPDATE;
    IF source_hash_value = ${literal(baseline.version.sourceHash)} THEN RETURN; END IF;
    IF source_id IS NULL OR source_hash_value <> '${previousSourceHash}' THEN
      RAISE EXCEPTION '当前主材库已偏离0917基线，请通过受控FULL导入校验并发布0919总表，禁止自动覆盖线上编辑';
    END IF;
    SELECT coalesce(max(version_number), 0) + 1 INTO next_version FROM main_material_catalog_versions;
    UPDATE main_material_catalog_versions SET status = 'SUPERSEDED' WHERE id = source_id;
    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash, validation_report, validated_at, published_at)
    VALUES ('${catalogId}', next_version, ${literal(baseline.version.name)}, 'PUBLISHED', 'BASELINE',
      ${literal(baseline.version.sourceFile)}, ${literal(baseline.version.sourceHash)}, ${json(baseline.summary)}, current_timestamp, current_timestamp);
    INSERT INTO main_material_assets (id, content_type, file_name, storage_path, size_bytes)
      SELECT a->>'id', a->>'contentType', a->>'fileName', 'main-materials/v1/images/' || (a->>'fileName'), (a->>'size')::bigint
      FROM jsonb_array_elements(${json(baseline.assets)}) a ON CONFLICT (id) DO NOTHING;
    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name, item_name, brand, series, model, spec, colors,
       unit, sale_price, cost_price, attributes, data_status, record_version, missing_fields, source_file, source_sheet,
       source_row, price_derivation, remarks)
      SELECT gen_random_uuid(), '${catalogId}', i->>'materialId', i->>'categoryCode', i->>'categoryName', i->>'itemName',
        i->>'brand', i->>'series', i->>'model', i->>'spec', i->'colors', i->>'unit', (i->>'salePrice')::numeric,
        (i->>'costPrice')::numeric, i->'attributes', i->>'status',
        greatest((i->>'recordVersion')::integer, coalesce(old.record_version + 1, 1)), i->>'missingFields',
        i->>'sourceFile', i->>'sourceSheet', i->>'sourceRow', i->>'priceDerivation', i->>'remarks'
      FROM jsonb_array_elements(${json(baseline.items)}) i
      LEFT JOIN main_material_item_versions old ON old.catalog_version_id = source_id AND old.material_id = i->>'materialId';
    INSERT INTO main_material_item_assets (catalog_version_id, material_id, asset_id, sort_order)
      SELECT '${catalogId}', i->>'materialId', a.value, a.ordinality - 1
      FROM jsonb_array_elements(${json(baseline.items.map(({ materialId, assetIds }) => ({ materialId, assetIds })))}) i,
           jsonb_array_elements_text(i->'assetIds') WITH ORDINALITY a(value, ordinality);
    -- No quotation or draft is changed: adopting this catalog remains an explicit user action.
  END $migration$;`);
}

export async function down(pgm) {
  pgm.sql(`DO $migration$
  DECLARE was_current boolean; previous_id uuid;
  BEGIN
    IF EXISTS (SELECT 1 FROM half_package_quotations WHERE main_material_catalog_version_id = '${catalogId}') THEN
      RAISE EXCEPTION '0919主材库已被报价引用，不允许回滚或改写报价快照';
    END IF;
    SELECT status = 'PUBLISHED' INTO was_current FROM main_material_catalog_versions WHERE id = '${catalogId}';
    SELECT id INTO previous_id FROM main_material_catalog_versions
      WHERE status = 'SUPERSEDED' AND id <> '${catalogId}' ORDER BY version_number DESC LIMIT 1;
    DELETE FROM main_material_item_assets WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}';
    DELETE FROM main_material_catalog_versions WHERE id = '${catalogId}';
    IF was_current THEN UPDATE main_material_catalog_versions SET status = 'PUBLISHED' WHERE id = previous_id; END IF;
  END $migration$;`);
}

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function json(value) { return `${literal(JSON.stringify(value))}::jsonb`; }

async function readBaselineCatalog() {
  const candidates = [
    resolve(process.cwd(), "apps/api/assets/main-materials/v1/catalog-0919.json"),
    resolve(process.cwd(), "assets/main-materials/v1/catalog-0919.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("找不到0919主材库基线资产");
}
