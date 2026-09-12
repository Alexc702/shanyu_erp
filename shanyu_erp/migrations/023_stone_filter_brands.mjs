const catalogId = "23232323-2323-4323-8323-232323232323";
const catalogName = "山屿 ERP 主材库 0912 石材品牌修正";
const sourceHash = "04a9b557195fff546332d37fa6822fb776896f194458e25c970b9dbc33782b14";

export function up(pgm) {
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
                    AND item.category_code = 'STONE'
                    AND item.item_name = '人造石'
                    AND item.brand = '人造石') = 6
            AND (SELECT count(*)
                   FROM main_material_item_versions item
                  WHERE item.catalog_version_id = catalog.id
                    AND item.category_code = 'STONE'
                    AND item.item_name = '天然大理石'
                    AND item.brand = '天然大理石') = 1
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
    SELECT '${catalogId}', next_version_number, '${catalogName}', 'PUBLISHED',
           source_type, source_file, '${sourceHash}', validation_report,
           current_timestamp, current_timestamp
      FROM main_material_catalog_versions
     WHERE id = source_catalog_id;

    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
    SELECT md5('${catalogId}:' || item.material_id)::uuid, '${catalogId}',
           item.material_id, item.category_code, item.category_name, item.item_name,
           CASE
             WHEN item.category_code = 'STONE'
              AND item.item_name IN ('人造石', '天然大理石') THEN item.item_name
             ELSE item.brand
           END,
           item.series, item.model, item.spec, item.colors, item.unit,
           item.sale_price, item.cost_price, item.attributes, item.data_status,
           item.record_version + CASE
             WHEN item.category_code = 'STONE'
              AND item.item_name IN ('人造石', '天然大理石') THEN 1
             ELSE 0
           END,
           CASE
             WHEN item.category_code = 'STONE' AND item.item_name = '人造石' THEN ''
             WHEN item.category_code = 'STONE' AND item.item_name = '天然大理石' THEN '产品图'
             ELSE item.missing_fields
           END,
           item.source_file, item.source_sheet, item.source_row,
           item.price_derivation, item.remarks
      FROM main_material_item_versions item
     WHERE item.catalog_version_id = source_catalog_id;

    INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
    SELECT '${catalogId}', material_id, asset_id, sort_order
      FROM main_material_item_assets
     WHERE catalog_version_id = source_catalog_id;
  END
  $migration$;`);
}

export function down(pgm) {
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
