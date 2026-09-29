import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogId = "39393939-3939-4393-8393-393939393939";
const categories = "'TILE', 'SEAM', 'FLOOR', 'GLASS_DOOR', 'CEILING', 'BATHROOM', 'SHOWER', 'STONE', 'SWITCH', 'CUSTOM', 'ART_PAINT'";
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;

export async function up(pgm) {
  const bytes = await readPatch();
  const patch = JSON.parse(bytes);
  if (patch.items.length !== 8 || patch.switchPrices.length !== 3 ||
      patch.items.some(item => item.categoryCode !== "ART_PAINT" || item.status !== "ACTIVE" || item.unit !== "M²" || item.assetIds.length) ||
      patch.switchPrices.some(item => item.salePrice !== "20.00")) throw new Error("0929 小范围更新资料不符合已确认范围");
  pgm.dropConstraint("main_material_item_versions", "main_material_item_versions_values");
  pgm.addConstraint("main_material_item_versions", "main_material_item_versions_values", {
    check: `record_version > 0 AND data_status IN ('ACTIVE', 'PENDING_DATA', 'INACTIVE') AND category_code IN (${categories})`,
  });
  pgm.dropConstraint("main_material_quote_lines", "main_material_quote_lines_values");
  pgm.addConstraint("main_material_quote_lines", "main_material_quote_lines_values", {
    check: `origin IN ('AUTO_TILE', 'MANUAL') AND quote_quantity >= 0 AND loss_rate >= 0 AND category_code IN (${categories}) AND ((origin = 'AUTO_TILE' AND source_half_package_line_id IS NOT NULL AND category_code = 'TILE') OR (origin = 'MANUAL' AND source_half_package_line_id IS NULL AND category_code <> 'TILE'))`,
  });
  pgm.sql(`DO $migration$
  DECLARE source_id uuid; next_version integer; added_count integer; updated_count integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions WHERE id = '${catalogId}') THEN RETURN; END IF;
    SELECT id INTO source_id FROM main_material_catalog_versions WHERE status = 'PUBLISHED' FOR UPDATE;
    IF source_id IS NULL THEN RAISE EXCEPTION '缺少已发布主材库，不能执行0929更新'; END IF;
    IF (SELECT count(*) FROM main_material_item_versions i JOIN jsonb_array_elements(${json(patch.switchPrices)}) p
          ON i.material_id = p->>'materialId' AND i.model = p->>'model'
          WHERE i.catalog_version_id = source_id AND i.category_code = 'SWITCH' AND i.brand = '公牛') <> 3 THEN
      RAISE EXCEPTION '公牛三款稳定ID/品牌/型号不一致，停止小范围更新';
    END IF;
    IF EXISTS (SELECT 1 FROM main_material_item_versions i JOIN jsonb_array_elements(${json(patch.items)}) p
          ON i.material_id = p->>'materialId' WHERE i.catalog_version_id = source_id
          AND (i.category_code <> 'ART_PAINT' OR i.item_name <> p->>'itemName' OR i.brand <> p->>'brand'
            OR i.series <> p->>'series' OR i.model <> p->>'model' OR i.spec <> p->>'spec'
            OR i.unit <> p->>'unit' OR i.sale_price IS DISTINCT FROM (p->>'salePrice')::numeric
            OR i.cost_price IS DISTINCT FROM (p->>'costPrice')::numeric OR i.data_status <> p->>'status')) THEN
      RAISE EXCEPTION '艺术漆稳定ID已有不同内容，须先确认差异，不覆盖线上编辑';
    END IF;
    SELECT count(*) INTO added_count FROM jsonb_array_elements(${json(patch.items)}) p
      WHERE NOT EXISTS (SELECT 1 FROM main_material_item_versions i WHERE i.catalog_version_id = source_id AND i.material_id = p->>'materialId');
    SELECT count(*) INTO updated_count FROM main_material_item_versions i JOIN jsonb_array_elements(${json(patch.switchPrices)}) p
      ON i.material_id = p->>'materialId' WHERE i.catalog_version_id = source_id AND i.sale_price IS DISTINCT FROM (p->>'salePrice')::numeric;
    IF added_count = 0 AND updated_count = 0 THEN RETURN; END IF;
    SELECT coalesce(max(version_number), 0) + 1 INTO next_version FROM main_material_catalog_versions;
    UPDATE main_material_catalog_versions SET status = 'SUPERSEDED' WHERE id = source_id;
    INSERT INTO main_material_catalog_versions
      (id, version_number, name, status, source_type, source_file, source_hash, validation_report, validated_at, published_at)
    VALUES ('${catalogId}', next_version, ${literal(patch.name)}, 'PUBLISHED', 'DELTA',
      '艺术漆主材库_v1.xlsx；开关面板主材库_v1.xlsx', ${literal(createHash("sha256").update(bytes).digest("hex"))},
      ${json({ scope: "0929_ART_PAINT_AND_BULL_PRICES", sourceFiles: patch.sourceFiles, warnings: ["艺术漆源资料未提供型号、规格和产品图；不补造颜色或图片"] })} || jsonb_build_object('added', added_count, 'updated', updated_count), current_timestamp, current_timestamp);
    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name, item_name, brand, series, model, spec, colors,
       unit, sale_price, cost_price, attributes, data_status, record_version, missing_fields, source_file, source_sheet,
       source_row, price_derivation, remarks)
    SELECT gen_random_uuid(), '${catalogId}', i.material_id, i.category_code, i.category_name, i.item_name, i.brand,
      i.series, i.model, i.spec, i.colors, i.unit, coalesce((p->>'salePrice')::numeric, i.sale_price), i.cost_price,
      i.attributes, i.data_status, i.record_version + CASE WHEN p IS NOT NULL AND i.sale_price IS DISTINCT FROM (p->>'salePrice')::numeric THEN 1 ELSE 0 END,
      i.missing_fields, i.source_file, i.source_sheet, i.source_row, i.price_derivation, i.remarks
    FROM main_material_item_versions i LEFT JOIN jsonb_array_elements(${json(patch.switchPrices)}) p ON i.material_id = p->>'materialId'
    WHERE i.catalog_version_id = source_id;
    INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name, item_name, brand, series, model, spec, colors,
       unit, sale_price, cost_price, attributes, data_status, record_version, missing_fields, source_file, source_sheet,
       source_row, price_derivation, remarks)
    SELECT gen_random_uuid(), '${catalogId}', p->>'materialId', p->>'categoryCode', p->>'categoryName', p->>'itemName',
      p->>'brand', p->>'series', p->>'model', p->>'spec', p->'colors', p->>'unit', (p->>'salePrice')::numeric,
      (p->>'costPrice')::numeric, p->'attributes', p->>'status', (p->>'recordVersion')::integer, p->>'missingFields',
      p->>'sourceFile', p->>'sourceSheet', p->>'sourceRow', p->>'priceDerivation', p->>'remarks'
    FROM jsonb_array_elements(${json(patch.items)}) p
    WHERE NOT EXISTS (SELECT 1 FROM main_material_item_versions i WHERE i.catalog_version_id = source_id AND i.material_id = p->>'materialId');
    INSERT INTO main_material_item_assets (catalog_version_id, material_id, asset_id, sort_order)
      SELECT '${catalogId}', material_id, asset_id, sort_order FROM main_material_item_assets WHERE catalog_version_id = source_id;
    UPDATE main_material_catalog_versions SET validation_report = validation_report ||
      (SELECT jsonb_build_object('itemCount', count(*), 'activeCount', count(*) FILTER (WHERE data_status = 'ACTIVE'),
        'pendingCount', count(*) FILTER (WHERE data_status = 'PENDING_DATA'), 'inactiveCount', count(*) FILTER (WHERE data_status = 'INACTIVE'))
       FROM main_material_item_versions WHERE catalog_version_id = '${catalogId}') WHERE id = '${catalogId}';
    -- No project binding, quotation, selected price, approval or export snapshot is written.
  END $migration$;`);
}

export function down() {
  throw new Error("039 已发布库可能被项目引用，禁止回滚改写历史数据；请通过新的受控版本更正");
}

async function readPatch() {
  for (const path of ["apps/api/assets", "assets"]) {
    try { return await readFile(resolve(process.cwd(), path, "main-materials/v1/catalog-0929-art-paint.json"), "utf8"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  throw new Error("找不到0929艺术漆与公牛售价更新资料");
}
