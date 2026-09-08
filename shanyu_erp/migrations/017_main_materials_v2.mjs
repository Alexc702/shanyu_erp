import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baselineCatalogId = "f7ec8a8a-12a4-4d5e-9c8b-99fd3ec29b17";

export async function up(pgm) {
  const baseline = await readBaselineCatalog();

  pgm.createTable("main_material_catalog_versions", {
    id: { type: "uuid", primaryKey: true },
    version_number: { type: "integer", notNull: true, unique: true },
    name: { type: "varchar(160)", notNull: true },
    status: { type: "varchar(24)", notNull: true },
    source_type: { type: "varchar(24)", notNull: true },
    source_file: { type: "text" },
    source_hash: { type: "char(64)" },
    validation_report: { type: "jsonb", notNull: true, default: "{}" },
    created_by_user_id: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
    validated_at: { type: "timestamptz" },
    published_at: { type: "timestamptz" },
  });
  pgm.addConstraint("main_material_catalog_versions", "main_material_catalog_versions_values", {
    check: "version_number > 0 AND status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED') AND source_type IN ('BASELINE', 'FULL', 'DELTA', 'ONLINE')",
  });
  pgm.createIndex("main_material_catalog_versions", ["status"], {
    unique: true,
    where: "status = 'PUBLISHED'",
  });

  pgm.createTable("main_material_item_versions", {
    id: { type: "uuid", primaryKey: true },
    catalog_version_id: { type: "uuid", notNull: true, references: "main_material_catalog_versions(id)", onDelete: "RESTRICT" },
    material_id: { type: "varchar(96)", notNull: true },
    category_code: { type: "varchar(32)", notNull: true },
    category_name: { type: "varchar(120)", notNull: true },
    item_name: { type: "varchar(255)", notNull: true, default: "" },
    brand: { type: "varchar(160)", notNull: true, default: "" },
    series: { type: "varchar(255)", notNull: true, default: "" },
    model: { type: "varchar(255)", notNull: true, default: "" },
    spec: { type: "text", notNull: true, default: "" },
    colors: { type: "jsonb", notNull: true, default: "[]" },
    unit: { type: "varchar(32)", notNull: true },
    sale_price: { type: "numeric(18,2)" },
    cost_price: { type: "numeric(18,2)" },
    attributes: { type: "jsonb", notNull: true, default: "{}" },
    data_status: { type: "varchar(24)", notNull: true },
    record_version: { type: "integer", notNull: true },
    missing_fields: { type: "text", notNull: true, default: "" },
    source_file: { type: "text", notNull: true, default: "" },
    source_sheet: { type: "text", notNull: true, default: "" },
    source_row: { type: "varchar(40)", notNull: true, default: "" },
    price_derivation: { type: "text", notNull: true, default: "" },
    remarks: { type: "text", notNull: true, default: "" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
  });
  pgm.addConstraint("main_material_item_versions", "main_material_item_versions_unique_material", {
    unique: ["catalog_version_id", "material_id"],
  });
  pgm.addConstraint("main_material_item_versions", "main_material_item_versions_values", {
    check: "record_version > 0 AND data_status IN ('ACTIVE', 'PENDING_DATA', 'INACTIVE') AND category_code IN ('TILE', 'SEAM', 'FLOOR', 'GLASS_DOOR', 'CEILING', 'BATHROOM', 'SHOWER', 'STONE', 'SWITCH', 'CUSTOM')",
  });
  pgm.createIndex("main_material_item_versions", ["catalog_version_id", "category_code", "data_status"]);
  pgm.createIndex("main_material_item_versions", ["material_id"]);

  pgm.createTable("main_material_assets", {
    id: { type: "char(64)", primaryKey: true },
    content_type: { type: "varchar(80)", notNull: true },
    file_name: { type: "text", notNull: true },
    storage_path: { type: "text", notNull: true, unique: true },
    size_bytes: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
  });

  pgm.createTable("main_material_item_assets", {
    catalog_version_id: { type: "uuid", notNull: true, references: "main_material_catalog_versions(id)", onDelete: "RESTRICT" },
    material_id: { type: "varchar(96)", notNull: true },
    asset_id: { type: "char(64)", notNull: true, references: "main_material_assets(id)", onDelete: "RESTRICT" },
    sort_order: { type: "integer", notNull: true, default: 0 },
  });
  pgm.addConstraint("main_material_item_assets", "main_material_item_assets_primary", {
    primaryKey: ["catalog_version_id", "material_id", "asset_id"],
  });
  pgm.addConstraint("main_material_item_assets", "main_material_item_assets_item", {
    foreignKeys: {
      columns: ["catalog_version_id", "material_id"],
      references: "main_material_item_versions(catalog_version_id, material_id)",
      onDelete: "RESTRICT",
    },
  });

  pgm.createTable("main_material_import_batches", {
    id: { type: "uuid", primaryKey: true },
    mode: { type: "varchar(16)", notNull: true },
    file_name: { type: "text", notNull: true },
    file_hash: { type: "char(64)", notNull: true },
    status: { type: "varchar(24)", notNull: true },
    validation_report: { type: "jsonb", notNull: true },
    normalized_payload: { type: "jsonb", notNull: true },
    created_by_user_id: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    published_version_id: { type: "uuid", references: "main_material_catalog_versions(id)", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
  });
  pgm.addConstraint("main_material_import_batches", "main_material_import_batches_values", {
    check: "mode IN ('FULL', 'DELTA') AND status IN ('FAILED', 'VALIDATED', 'PUBLISHED') AND ((status = 'PUBLISHED' AND published_version_id IS NOT NULL) OR (status <> 'PUBLISHED' AND published_version_id IS NULL))",
  });
  pgm.createIndex("main_material_import_batches", ["file_hash", "mode"], { unique: true });

  pgm.createTable("half_package_main_material_demand_tags", {
    standard_item_id: { type: "uuid", primaryKey: true, references: "standard_engineering_items(id)", onDelete: "RESTRICT" },
    demand_type: { type: "varchar(24)", notNull: true },
    target_spec: { type: "varchar(80)", notNull: true },
    surface_type: { type: "varchar(24)", notNull: true },
  });
  pgm.addConstraint("half_package_main_material_demand_tags", "half_package_main_material_demand_tags_values", {
    check: "demand_type = 'TILE' AND surface_type IN ('FLOOR', 'WALL')",
  });

  pgm.addColumns("half_package_quotations", {
    main_material_catalog_version_id: { type: "uuid", references: "main_material_catalog_versions(id)", onDelete: "RESTRICT" },
    main_material_direct_cost: { type: "numeric(16,4)", notNull: true, default: 0 },
    main_material_management_fee: { type: "numeric(16,4)", notNull: true, default: 0 },
    main_material_total: { type: "numeric(16,4)", notNull: true, default: 0 },
    main_material_expected_cost: { type: "numeric(16,4)", notNull: true, default: 0 },
  });
  pgm.dropConstraint("half_package_quotations", "half_package_quotations_adjustment_values");
  pgm.addConstraint("half_package_quotations", "half_package_quotations_adjustment_values", {
    check: "discount_rate >= 0 AND discount_rate <= 1 AND write_off >= 0 AND adjusted_total >= 0 AND adjusted_total = greatest(round(((total + main_material_total) * discount_rate) - write_off, 4), 0)",
  });
  pgm.addColumns("half_package_exports", {
    audience: { type: "varchar(16)", notNull: true, default: "CLIENT" },
  });
  pgm.addConstraint("half_package_exports", "half_package_exports_audience", {
    check: "audience IN ('CLIENT', 'INTERNAL')",
  });

  pgm.createTable("main_material_quote_lines", {
    id: { type: "uuid", primaryKey: true },
    quotation_id: { type: "uuid", notNull: true, references: "half_package_quotations(id)", onDelete: "CASCADE" },
    origin: { type: "varchar(24)", notNull: true },
    source_half_package_line_id: { type: "uuid", references: "half_package_quotation_lines(id)", onDelete: "RESTRICT" },
    category_code: { type: "varchar(32)", notNull: true },
    scope_name: { type: "varchar(120)", notNull: true },
    demand_name: { type: "varchar(255)", notNull: true },
    demand_spec: { type: "varchar(120)", notNull: true, default: "" },
    base_quantity: { type: "numeric(18,4)" },
    loss_rate: { type: "numeric(7,4)", notNull: true, default: 0 },
    quote_quantity: { type: "numeric(18,4)", notNull: true },
    item_version_id: { type: "uuid", references: "main_material_item_versions(id)", onDelete: "RESTRICT" },
    material_id: { type: "varchar(96)" },
    item_name: { type: "varchar(255)" },
    brand: { type: "varchar(160)" },
    series: { type: "varchar(255)" },
    model: { type: "varchar(255)" },
    spec: { type: "text" },
    selected_color: { type: "varchar(255)" },
    unit: { type: "varchar(32)" },
    sale_unit_price: { type: "numeric(18,2)" },
    cost_unit_price: { type: "numeric(18,2)" },
    sale_amount: { type: "numeric(18,4)" },
    cost_amount: { type: "numeric(18,4)" },
    asset_ids: { type: "jsonb", notNull: true, default: "[]" },
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
  });
  pgm.addConstraint("main_material_quote_lines", "main_material_quote_lines_values", {
    check: "origin IN ('AUTO_TILE', 'MANUAL') AND quote_quantity >= 0 AND loss_rate >= 0 AND category_code IN ('TILE', 'SEAM', 'FLOOR', 'GLASS_DOOR', 'CEILING', 'BATHROOM', 'SHOWER', 'STONE', 'SWITCH', 'CUSTOM') AND ((origin = 'AUTO_TILE' AND source_half_package_line_id IS NOT NULL AND category_code = 'TILE') OR (origin = 'MANUAL' AND source_half_package_line_id IS NULL AND category_code <> 'TILE'))",
  });
  pgm.createIndex("main_material_quote_lines", ["quotation_id", "sort_order"]);
  pgm.createIndex("main_material_quote_lines", ["quotation_id", "source_half_package_line_id"], {
    unique: true,
    where: "source_half_package_line_id IS NOT NULL",
  });

  pgm.sql(`INSERT INTO main_material_catalog_versions
    (id, version_number, name, status, source_type, source_file, source_hash,
     validation_report, validated_at, published_at)
    VALUES ('${baselineCatalogId}', 1, '山屿 ERP 主材库 V1', 'PUBLISHED',
      'BASELINE', '山屿ERP主材库_v1.xlsx', ${literal(baseline.version.sourceHash)},
      ${literal(JSON.stringify(baseline.summary))}::jsonb, current_timestamp, current_timestamp)`);

  for (const batch of chunks(baseline.assets, 80)) {
    pgm.sql(`INSERT INTO main_material_assets
      (id, content_type, file_name, storage_path, size_bytes)
      VALUES ${batch.map((asset) => `(${literal(asset.id)}, ${literal(asset.contentType)},
        ${literal(asset.fileName)}, ${literal(`main-materials/v1/images/${asset.fileName}`)}, ${Number(asset.size)})`).join(",\n")}`);
  }
  for (const batch of chunks(baseline.items, 60)) {
    pgm.sql(`INSERT INTO main_material_item_versions
      (id, catalog_version_id, material_id, category_code, category_name,
       item_name, brand, series, model, spec, colors, unit, sale_price,
       cost_price, attributes, data_status, record_version, missing_fields,
       source_file, source_sheet, source_row, price_derivation, remarks)
      VALUES ${batch.map(itemValues).join(",\n")}`);
  }
  const mappings = baseline.items.flatMap((item) =>
    item.assetIds.map((assetId, sortOrder) => ({ assetId, materialId: item.materialId, sortOrder })),
  );
  for (const batch of chunks(mappings, 100)) {
    pgm.sql(`INSERT INTO main_material_item_assets
      (catalog_version_id, material_id, asset_id, sort_order)
      VALUES ${batch.map((mapping) => `('${baselineCatalogId}', ${literal(mapping.materialId)}, ${literal(mapping.assetId)}, ${mapping.sortOrder})`).join(",\n")}`);
  }

  pgm.sql(`INSERT INTO half_package_main_material_demand_tags
      (standard_item_id, demand_type, target_spec, surface_type)
    SELECT DISTINCT ON (item.standard_item_id)
      item.standard_item_id,
      'TILE',
      CASE WHEN item.item_name LIKE '%多规格%' THEN '多规格'
           ELSE (regexp_match(item.item_name, '([0-9]+\\*[0-9]+)'))[1] END,
      CASE WHEN item.item_name LIKE '%墙砖%' OR item.item_name LIKE '%小砖%' THEN 'WALL' ELSE 'FLOOR' END
      FROM half_package_version_items item
     WHERE item.item_name ~ '(地砖|墙砖|小砖|木纹砖|古堡砖)'
       AND (item.item_name LIKE '%粘贴%' OR item.item_name LIKE '%粘帖%')
     ORDER BY item.standard_item_id, item.item_name`);

  pgm.createFunction("reject_main_material_catalog_snapshot_mutation", [], {
    returns: "trigger",
    language: "plpgsql",
  }, `BEGIN
    IF EXISTS (SELECT 1 FROM main_material_catalog_versions catalog
      WHERE catalog.id = coalesce(OLD.catalog_version_id, NEW.catalog_version_id)
        AND catalog.status IN ('PUBLISHED', 'SUPERSEDED')) THEN
      RAISE EXCEPTION 'published main material catalog snapshots are immutable';
    END IF;
    RETURN coalesce(NEW, OLD);
  END`);
  pgm.sql(`CREATE TRIGGER main_material_item_versions_immutable
    BEFORE UPDATE OR DELETE ON main_material_item_versions
    FOR EACH ROW EXECUTE FUNCTION reject_main_material_catalog_snapshot_mutation()`);
  pgm.sql(`CREATE TRIGGER main_material_item_assets_immutable
    BEFORE UPDATE OR DELETE ON main_material_item_assets
    FOR EACH ROW EXECUTE FUNCTION reject_main_material_catalog_snapshot_mutation()`);

  pgm.createFunction("reject_main_material_quote_snapshot_mutation", [], {
    returns: "trigger",
    language: "plpgsql",
  }, `BEGIN
    IF EXISTS (SELECT 1 FROM half_package_quotations quotation
      WHERE quotation.id = coalesce(OLD.quotation_id, NEW.quotation_id)
        AND quotation.status <> 'DRAFT') THEN
      RAISE EXCEPTION 'generated main material quotation snapshots are immutable';
    END IF;
    RETURN coalesce(NEW, OLD);
  END`);
  pgm.sql(`CREATE TRIGGER main_material_quote_lines_immutable
    BEFORE UPDATE OR DELETE ON main_material_quote_lines
    FOR EACH ROW EXECUTE FUNCTION reject_main_material_quote_snapshot_mutation()`);
}

export async function down(pgm) {
  pgm.sql("DROP TRIGGER main_material_quote_lines_immutable ON main_material_quote_lines");
  pgm.dropFunction("reject_main_material_quote_snapshot_mutation", []);
  pgm.dropTable("main_material_quote_lines");
  pgm.dropConstraint("half_package_exports", "half_package_exports_audience");
  pgm.dropColumns("half_package_exports", ["audience"]);
  pgm.dropConstraint("half_package_quotations", "half_package_quotations_adjustment_values");
  pgm.addConstraint("half_package_quotations", "half_package_quotations_adjustment_values", {
    check: "discount_rate >= 0 AND discount_rate <= 1 AND write_off >= 0 AND adjusted_total >= 0 AND adjusted_total = greatest(round((total * discount_rate) - write_off, 4), 0)",
  });
  pgm.dropColumns("half_package_quotations", [
    "main_material_catalog_version_id", "main_material_direct_cost",
    "main_material_management_fee", "main_material_total", "main_material_expected_cost",
  ]);
  pgm.dropTable("half_package_main_material_demand_tags");
  pgm.dropTable("main_material_import_batches");
  pgm.sql("DROP TRIGGER main_material_item_assets_immutable ON main_material_item_assets");
  pgm.sql("DROP TRIGGER main_material_item_versions_immutable ON main_material_item_versions");
  pgm.dropFunction("reject_main_material_catalog_snapshot_mutation", []);
  pgm.dropTable("main_material_item_assets");
  pgm.dropTable("main_material_assets");
  pgm.dropTable("main_material_item_versions");
  pgm.dropTable("main_material_catalog_versions");
}

function itemValues(item) {
  const attributes = {
    type: item.type, woodSpecies: item.woodSpecies, substrate: item.substrate,
    thickness: item.thickness, grade: item.grade, lockType: item.lockType,
    packaging: item.packaging, panelSize: item.panelSize,
    lightingPower: item.lightingPower, imageReference: item.imageReference,
  };
  return `('${stableUuid(`${baselineCatalogId}:${item.materialId}`)}', '${baselineCatalogId}',
    ${literal(item.materialId)}, ${literal(item.categoryCode)}, ${literal(item.categoryName)},
    ${literal(item.itemName)}, ${literal(item.brand)}, ${literal(item.series)},
    ${literal(item.model)}, ${literal(item.spec)}, ${literal(JSON.stringify(item.colors))}::jsonb,
    ${literal(item.unit)}, ${nullableNumber(item.salePrice)}, ${nullableNumber(item.costPrice)},
    ${literal(JSON.stringify(attributes))}::jsonb, ${literal(item.status)}, ${Number(item.recordVersion)},
    ${literal(item.missingFields)}, ${literal(item.sourceFile)}, ${literal(item.sourceSheet)},
    ${literal(item.sourceRow)}, ${literal(item.priceDerivation)}, ${literal(item.remarks)})`;
}

function stableUuid(value) {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ["8", "9", "a", "b"][Number.parseInt(hash[16], 16) % 4];
  const joined = hash.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function literal(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function nullableNumber(value) {
  return value === null || value === undefined || value === "" ? "NULL" : String(value);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
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
