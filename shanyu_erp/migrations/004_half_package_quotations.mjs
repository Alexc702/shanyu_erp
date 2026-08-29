const ruleVersionId = "77777777-7777-4777-8777-777777777777";

export async function up(pgm) {
  pgm.createType("half_package_quantity_rule_kind", [
    "MANUAL",
    "PROJECT_BUILDING_AREA",
    "SPACE_AREA",
    "SPACE_PERIMETER_HEIGHT",
    "LINE_REFERENCE",
  ]);

  pgm.createTable("half_package_quantity_rule_versions", {
    id: { type: "uuid", primaryKey: true },
    version_number: { type: "integer", notNull: true, unique: true },
    name: { type: "varchar(120)", notNull: true },
    rules: { type: "jsonb", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint(
    "half_package_quantity_rule_versions",
    "half_package_quantity_rule_versions_positive",
    { check: "version_number > 0" },
  );
  pgm.sql(`
    INSERT INTO half_package_quantity_rule_versions
      (id, version_number, name, rules)
    VALUES (
      '${ruleVersionId}',
      1,
      'V1 已确认基础数量规则',
      '{
        "projectBuildingArea": ["油漆工程3项", "水电指定7项", "其他工程第2/3项"],
        "spaceArea": ["顶面基层处理", "厨卫防水石膏板吊平顶"],
        "spacePerimeterHeight": ["墙面基层处理"],
        "lineReference": ["顶面乳胶漆", "墙面乳胶漆", "厨卫顶面基层处理"],
        "unconfirmedComplexRules": "保持手工数量，不新增局部参数"
      }'::jsonb
    )
  `);
  pgm.sql(`
    CREATE FUNCTION reject_half_package_rule_version_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '已发布半包数量规则版本不可修改或删除';
    END;
    $$;
  `);
  pgm.sql(`
    CREATE TRIGGER half_package_quantity_rule_versions_immutable
    BEFORE UPDATE OR DELETE ON half_package_quantity_rule_versions
    FOR EACH ROW EXECUTE FUNCTION reject_half_package_rule_version_mutation()
  `);

  pgm.createTable("half_package_quotations", {
    id: { type: "uuid", primaryKey: true },
    project_id: {
      type: "uuid",
      notNull: true,
      references: "projects(id)",
      onDelete: "RESTRICT",
    },
    version_number: { type: "integer", notNull: true, default: 1 },
    status: { type: "varchar(32)", notNull: true, default: "DRAFT" },
    template_version_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_template_versions(id)",
      onDelete: "RESTRICT",
    },
    quantity_rule_version_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quantity_rule_versions(id)",
      onDelete: "RESTRICT",
    },
    building_area: { type: "numeric(14,4)", notNull: true },
    management_rate: { type: "numeric(7,4)", notNull: true },
    direct_cost: { type: "numeric(16,4)", notNull: true, default: 0 },
    management_fee: { type: "numeric(16,4)", notNull: true, default: 0 },
    total: { type: "numeric(16,4)", notNull: true, default: 0 },
    revision: { type: "integer", notNull: true, default: 0 },
    created_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint("half_package_quotations", "half_package_quotations_state", {
    check: "status = 'DRAFT'",
  });
  pgm.addConstraint("half_package_quotations", "half_package_quotations_values", {
    check:
      "version_number > 0 AND revision >= 0 AND building_area > 0 AND " +
      "management_rate >= 0 AND management_rate <= 1 AND " +
      "direct_cost >= 0 AND management_fee >= 0 AND total >= 0",
  });
  pgm.addConstraint("half_package_quotations", "half_package_quotations_version", {
    unique: ["project_id", "version_number"],
  });
  pgm.createIndex(
    "half_package_quotations",
    ["project_id"],
    { unique: true, where: "status = 'DRAFT'" },
  );

  pgm.createTable("half_package_quotation_spaces", {
    id: { type: "uuid", primaryKey: true },
    quotation_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quotations(id)",
      onDelete: "CASCADE",
    },
    project_space_id: {
      type: "uuid",
      references: "project_spaces(id)",
      onDelete: "RESTRICT",
    },
    name: { type: "varchar(100)", notNull: true },
    space_type: { type: "space_type" },
    area: { type: "numeric(14,4)" },
    perimeter: { type: "numeric(14,4)" },
    height: { type: "numeric(14,4)" },
    subtotal: { type: "numeric(16,4)", notNull: true, default: 0 },
    sort_order: { type: "integer", notNull: true },
  });
  pgm.addConstraint(
    "half_package_quotation_spaces",
    "half_package_quotation_spaces_shape",
    {
      check:
        "sort_order >= 0 AND subtotal >= 0 AND " +
        "((project_space_id IS NULL AND space_type IS NULL AND area IS NULL " +
        "AND perimeter IS NULL AND height IS NULL) OR " +
        "(project_space_id IS NOT NULL AND space_type IS NOT NULL " +
        "AND area > 0 AND perimeter > 0 AND height > 0))",
    },
  );
  pgm.addConstraint(
    "half_package_quotation_spaces",
    "half_package_quotation_spaces_order",
    { unique: ["quotation_id", "sort_order"] },
  );
  pgm.createIndex("half_package_quotation_spaces", ["project_space_id"]);

  pgm.createTable("half_package_quotation_lines", {
    id: { type: "uuid", primaryKey: true },
    quotation_space_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quotation_spaces(id)",
      onDelete: "CASCADE",
    },
    version_item_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_version_items(id)",
      onDelete: "RESTRICT",
    },
    section_code: { type: "half_package_section_code", notNull: true },
    section_name: { type: "varchar(100)", notNull: true },
    item_name: { type: "varchar(255)", notNull: true },
    unit: { type: "varchar(32)", notNull: true },
    remarks: { type: "text" },
    sort_order: { type: "integer", notNull: true },
    selected: { type: "boolean", notNull: true, default: false },
    quantity_rule_kind: {
      type: "half_package_quantity_rule_kind",
      notNull: true,
    },
    referenced_line_id: { type: "uuid" },
    manual_quantity: { type: "numeric(14,4)" },
    calculated_quantity: { type: "numeric(14,4)" },
    sale_unit_price: { type: "numeric(14,4)", notNull: true },
    sale_amount: { type: "numeric(16,4)" },
  });
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_values",
    {
      check:
        "sort_order >= 0 AND sale_unit_price > 0 AND " +
        "(manual_quantity IS NULL OR manual_quantity > 0) AND " +
        "(calculated_quantity IS NULL OR calculated_quantity > 0) AND " +
        "(sale_amount IS NULL OR sale_amount > 0)",
    },
  );
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_rule_reference",
    {
      check:
        "(quantity_rule_kind = 'LINE_REFERENCE' AND referenced_line_id IS NOT NULL) OR " +
        "(quantity_rule_kind <> 'LINE_REFERENCE' AND referenced_line_id IS NULL)",
    },
  );
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_item",
    { unique: ["quotation_space_id", "version_item_id"] },
  );
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_reference_fk",
    {
      foreignKeys: {
        columns: "referenced_line_id",
        references: "half_package_quotation_lines(id)",
        onDelete: "RESTRICT",
      },
    },
  );
  pgm.createIndex("half_package_quotation_lines", ["quotation_space_id", "sort_order"]);
}

export async function down(pgm) {
  pgm.dropTable("half_package_quotation_lines");
  pgm.dropTable("half_package_quotation_spaces");
  pgm.dropTable("half_package_quotations");
  pgm.sql("DROP TRIGGER half_package_quantity_rule_versions_immutable ON half_package_quantity_rule_versions");
  pgm.dropFunction("reject_half_package_rule_version_mutation", []);
  pgm.dropTable("half_package_quantity_rule_versions");
  pgm.dropType("half_package_quantity_rule_kind");
}
