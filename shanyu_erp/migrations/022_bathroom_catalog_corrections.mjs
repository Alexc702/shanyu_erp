import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "22222222-2222-4222-8222-222222222222";

export async function up(pgm) {
  const baseline = await readBaselineCatalog();
  const mappings = baseline.items.flatMap((item) =>
    item.assetIds.map((assetId, sortOrder) => ({ assetId, materialId: item.materialId, sortOrder })),
  );

  pgm.sql(`DO $migration$
  DECLARE
    source_catalog_id uuid;
    next_version_number integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions WHERE id = '${catalogId}') OR
       EXISTS (
         SELECT 1
           FROM main_material_catalog_versions catalog
          WHERE catalog.status = 'PUBLISHED'
            AND (SELECT count(*)
                   FROM main_material_item_versions item
                  WHERE item.catalog_version_id = catalog.id
                    AND item.category_code = 'BATHROOM'
                    AND item.brand = '德利丰'
                    AND item.attributes->>'variantGroup' LIKE '定制浴室柜:%'
                    AND item.model IN ('免漆浴室柜（主卫）', '免漆浴室柜（公卫）',
                                       '烤漆浴室柜（主卫）', '烤漆浴室柜（公卫）')) = 120
            AND NOT EXISTS (
              SELECT 1
                FROM (VALUES
                  ('MAT-BATHROOM-B529657C0264', 'ed1fce1dd20a96d2ac907e112eda2ab949d7ed0c179bbfe25b97303fd5c88ce1'),
                  ('MAT-BATHROOM-DC20B75812EF', 'eaa1f9c245abfb03794f3fcf6a5434fc499365a8f2d5d0d4937e81b796a31e6e'),
                  ('MAT-BATHROOM-C4DA5BD71DE9', '154c4ec627dc8d7d5399963ab7860a93df9c7eb4a6d92d8f8a3e6f934faf62da'),
                  ('MAT-BATHROOM-1165182E1333', '7d18d004cc4de4281db40e48bf7047434c61df0275e0d6f804c4b1f73c0d61df'),
                  ('MAT-BATHROOM-67C264B2952F', '398d829b1ff8b346e9c32d8ba6946708351d99a1debadea0f8c4212957beaa3e'),
                  ('MAT-BATHROOM-D22F2F4E8983', '28fa52108e631c5ec0c8b51b2b5dd179c7d3a3a833df1d6488e85e86709358ad'),
                  ('MAT-BATHROOM-539488A9C0DD', '0e5b59a0436d4ce2d0ff378eb70b171f8bd39b65d0246b7bbdfc4405f18708f3')
                ) expected(material_id, asset_id)
               WHERE (SELECT count(*)
                        FROM main_material_item_assets link
                       WHERE link.catalog_version_id = catalog.id
                         AND link.material_id = expected.material_id) <> 1
                  OR NOT EXISTS (
                    SELECT 1
                      FROM main_material_item_assets link
                     WHERE link.catalog_version_id = catalog.id
                       AND link.material_id = expected.material_id
                       AND link.asset_id = expected.asset_id
                  )
            )
       ) THEN
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

    SELECT coalesce(max(version_number), 0) + 1 INTO next_version_number
      FROM main_material_catalog_versions;
    UPDATE main_material_catalog_versions SET status = 'SUPERSEDED'
     WHERE id = source_catalog_id;
    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash,
       validation_report, validated_at, published_at)
    VALUES ('${catalogId}', next_version_number, ${literal(baseline.version.name)}, 'PUBLISHED',
      'BASELINE', ${literal(baseline.version.sourceFile)}, ${literal(baseline.version.sourceHash)},
      '{}'::jsonb, current_timestamp, current_timestamp);

    INSERT INTO main_material_assets
      (id, content_type, file_name, storage_path, size_bytes)
    VALUES ${baseline.assets.map((asset) => `(${literal(asset.id)}, ${literal(asset.contentType)},
      ${literal(asset.fileName)}, ${literal(`main-materials/v1/images/${asset.fileName}`)}, ${Number(asset.size)})`).join(",\n")}
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
    VALUES ${baseline.items.map(itemValues).join(",\n")};

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    VALUES ${mappings.map((mapping) => `('${catalogId}', ${literal(mapping.materialId)}, ${literal(mapping.assetId)}, ${mapping.sortOrder})`).join(",\n")};

    UPDATE main_material_catalog_versions
       SET validation_report = ${literal(JSON.stringify(baseline.summary))}::jsonb
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

function itemValues(item) {
  return `('${stableUuid(`${catalogId}:${item.materialId}`)}', '${catalogId}',
    ${literal(item.materialId)}, ${literal(item.categoryCode)}, ${literal(item.categoryName)},
    ${literal(item.itemName)}, ${literal(item.brand)}, ${literal(item.series)}, ${literal(item.model)},
    ${literal(item.spec)}, ${literal(JSON.stringify(item.colors))}::jsonb, ${literal(item.unit)},
    ${nullableNumber(item.salePrice)}, ${nullableNumber(item.costPrice)},
    ${literal(JSON.stringify(item.attributes))}::jsonb, ${literal(item.status)}, ${Number(item.recordVersion)},
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
  throw new Error("找不到主材库 0912 卫浴修正资产");
}
