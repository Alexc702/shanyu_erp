export async function up(pgm) {
  pgm.createType("catalog_import_status", ["FAILED", "VALIDATED", "PUBLISHED"]);
  pgm.createType("half_package_section_code", [
    "WALL",
    "LIVING_DINING",
    "BEDROOM",
    "BALCONY",
    "KITCHEN_BATHROOM",
    "PAINT",
    "ELECTRICAL",
    "OTHER",
  ]);

  pgm.createTable("catalog_import_batches", {
    id: { type: "uuid", primaryKey: true },
    file_name: { type: "varchar(255)", notNull: true },
    file_hash: { type: "char(64)", notNull: true, unique: true },
    source_sheet: { type: "varchar(100)", notNull: true },
    status: { type: "catalog_import_status", notNull: true },
    validation_report: { type: "jsonb", notNull: true },
    created_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    published_version_id: { type: "uuid" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint("catalog_import_batches", "catalog_import_batches_publish_state", {
    check:
      "(status = 'PUBLISHED' AND published_version_id IS NOT NULL) OR " +
      "(status <> 'PUBLISHED' AND published_version_id IS NULL)",
  });
  pgm.createIndex("catalog_import_batches", ["created_at"]);

  pgm.createTable("catalog_import_sections", {
    id: { type: "uuid", primaryKey: true },
    batch_id: {
      type: "uuid",
      notNull: true,
      references: "catalog_import_batches(id)",
      onDelete: "CASCADE",
    },
    code: { type: "half_package_section_code", notNull: true },
    name: { type: "varchar(100)", notNull: true },
    sort_order: { type: "integer", notNull: true },
    item_count: { type: "integer", notNull: true },
  });
  pgm.addConstraint("catalog_import_sections", "catalog_import_sections_positive", {
    check: "sort_order >= 0 AND item_count > 0",
  });
  pgm.addConstraint("catalog_import_sections", "catalog_import_sections_unique_code", {
    unique: ["batch_id", "code"],
  });
  pgm.addConstraint("catalog_import_sections", "catalog_import_sections_unique_order", {
    unique: ["batch_id", "sort_order"],
  });

  pgm.createTable("catalog_import_items", {
    id: { type: "uuid", primaryKey: true },
    section_id: {
      type: "uuid",
      notNull: true,
      references: "catalog_import_sections(id)",
      onDelete: "CASCADE",
    },
    source_row: { type: "integer", notNull: true },
    sort_order: { type: "integer", notNull: true },
    item_name: { type: "varchar(255)", notNull: true },
    unit: { type: "varchar(32)", notNull: true },
    raw_quantity: { type: "text" },
    quantity_formula: { type: "text" },
    sale_unit_price: { type: "numeric(14,4)" },
    cost_unit_price: { type: "numeric(14,4)" },
    remarks: { type: "text" },
  });
  pgm.addConstraint("catalog_import_items", "catalog_import_items_positive", {
    check:
      "source_row > 0 AND sort_order >= 0 AND " +
      "(sale_unit_price IS NULL OR sale_unit_price > 0) AND " +
      "(cost_unit_price IS NULL OR cost_unit_price > 0)",
  });
  pgm.addConstraint("catalog_import_items", "catalog_import_items_unique_order", {
    unique: ["section_id", "sort_order"],
  });
  pgm.addConstraint("catalog_import_items", "catalog_import_items_unique_source_row", {
    unique: ["section_id", "source_row"],
  });

  pgm.createTable("standard_engineering_items", {
    id: { type: "uuid", primaryKey: true },
    catalog_key: { type: "varchar(600)", notNull: true, unique: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createTable("half_package_template_versions", {
    id: { type: "uuid", primaryKey: true },
    version_number: { type: "integer", notNull: true, unique: true },
    source_batch_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "catalog_import_batches(id)",
      onDelete: "RESTRICT",
    },
    published_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    published_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint("half_package_template_versions", "half_package_version_positive", {
    check: "version_number > 0",
  });

  pgm.createTable("half_package_sections", {
    id: { type: "uuid", primaryKey: true },
    template_version_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_template_versions(id)",
      onDelete: "RESTRICT",
    },
    code: { type: "half_package_section_code", notNull: true },
    name: { type: "varchar(100)", notNull: true },
    sort_order: { type: "integer", notNull: true },
    item_count: { type: "integer", notNull: true },
  });
  pgm.addConstraint("half_package_sections", "half_package_sections_positive", {
    check: "sort_order >= 0 AND item_count > 0",
  });
  pgm.addConstraint("half_package_sections", "half_package_sections_unique_code", {
    unique: ["template_version_id", "code"],
  });
  pgm.addConstraint("half_package_sections", "half_package_sections_unique_order", {
    unique: ["template_version_id", "sort_order"],
  });

  pgm.createTable("half_package_version_items", {
    id: { type: "uuid", primaryKey: true },
    template_version_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_template_versions(id)",
      onDelete: "RESTRICT",
    },
    section_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_sections(id)",
      onDelete: "RESTRICT",
    },
    standard_item_id: {
      type: "uuid",
      notNull: true,
      references: "standard_engineering_items(id)",
      onDelete: "RESTRICT",
    },
    source_import_item_id: {
      type: "uuid",
      notNull: true,
      references: "catalog_import_items(id)",
      onDelete: "RESTRICT",
    },
    item_name: { type: "varchar(255)", notNull: true },
    unit: { type: "varchar(32)", notNull: true },
    raw_quantity: { type: "text" },
    quantity_formula: { type: "text" },
    remarks: { type: "text" },
    sort_order: { type: "integer", notNull: true },
  });
  pgm.addConstraint("half_package_version_items", "half_package_version_items_order", {
    check: "sort_order >= 0",
  });
  pgm.addConstraint("half_package_version_items", "half_package_version_items_unique_order", {
    unique: ["template_version_id", "sort_order"],
  });
  pgm.addConstraint("half_package_version_items", "half_package_version_items_unique_standard", {
    unique: ["template_version_id", "standard_item_id"],
  });

  pgm.createTable("half_package_item_price_versions", {
    id: { type: "uuid", primaryKey: true },
    version_item_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "half_package_version_items(id)",
      onDelete: "RESTRICT",
    },
    sale_unit_price: { type: "numeric(14,4)", notNull: true },
    cost_unit_price: { type: "numeric(14,4)", notNull: true },
  });
  pgm.addConstraint("half_package_item_price_versions", "half_package_item_prices_positive", {
    check: "sale_unit_price > 0 AND cost_unit_price > 0",
  });

  pgm.addConstraint(
    "catalog_import_batches",
    "catalog_import_batches_published_version_fk",
    {
      foreignKeys: {
        columns: "published_version_id",
        references: "half_package_template_versions(id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.sql(`
    CREATE FUNCTION reject_half_package_snapshot_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '已发布半包主材库版本不可修改或删除';
    END;
    $$;
  `);
  for (const table of [
    "half_package_template_versions",
    "half_package_sections",
    "half_package_version_items",
    "half_package_item_price_versions",
  ]) {
    pgm.sql(`
      CREATE TRIGGER ${table}_immutable
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_half_package_snapshot_mutation()
    `);
  }
}

export async function down(pgm) {
  pgm.dropConstraint(
    "catalog_import_batches",
    "catalog_import_batches_published_version_fk",
  );
  pgm.dropTable("half_package_item_price_versions");
  pgm.dropTable("half_package_version_items");
  pgm.dropTable("half_package_sections");
  pgm.dropTable("half_package_template_versions");
  pgm.dropFunction("reject_half_package_snapshot_mutation", []);
  pgm.dropTable("standard_engineering_items");
  pgm.dropTable("catalog_import_items");
  pgm.dropTable("catalog_import_sections");
  pgm.dropTable("catalog_import_batches");
  pgm.dropType("half_package_section_code");
  pgm.dropType("catalog_import_status");
}
