export async function up(pgm) {
  pgm.createType("space_type", [
    "LIVING_DINING",
    "BEDROOM",
    "KITCHEN",
    "BATHROOM",
    "BALCONY",
  ]);

  pgm.createTable("projects", {
    id: { type: "uuid", primaryKey: true },
    name: { type: "varchar(100)", notNull: true },
    customer_name: { type: "varchar(100)", notNull: true },
    address: { type: "varchar(500)", notNull: true },
    building_area: { type: "numeric(14,4)", notNull: true },
    lead_designer_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
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
  pgm.addConstraint("projects", "projects_building_area_positive", {
    check: "building_area > 0",
  });
  pgm.createIndex("projects", ["lead_designer_id", "created_at"]);

  pgm.createTable("project_spaces", {
    id: { type: "uuid", primaryKey: true },
    project_id: {
      type: "uuid",
      notNull: true,
      references: "projects(id)",
      onDelete: "CASCADE",
    },
    type: { type: "space_type", notNull: true },
    display_name: { type: "varchar(24)", notNull: true },
    area: { type: "numeric(14,4)", notNull: true },
    perimeter: { type: "numeric(14,4)", notNull: true },
    height: { type: "numeric(14,4)", notNull: true },
    includes_balcony: { type: "boolean", notNull: true, default: false },
    sort_order: { type: "integer", notNull: true },
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
  pgm.addConstraint("project_spaces", "project_spaces_name_length", {
    check: "char_length(btrim(display_name)) BETWEEN 1 AND 6",
  });
  pgm.addConstraint("project_spaces", "project_spaces_metrics_positive", {
    check: "area > 0 AND perimeter > 0 AND height > 0",
  });
  pgm.addConstraint("project_spaces", "project_spaces_balcony_scope", {
    check: "type = 'LIVING_DINING' OR includes_balcony = false",
  });
  pgm.addConstraint("project_spaces", "project_spaces_sort_non_negative", {
    check: "sort_order >= 0",
  });
  pgm.addConstraint("project_spaces", "project_spaces_unique_name", {
    unique: ["project_id", "display_name"],
  });
  pgm.addConstraint("project_spaces", "project_spaces_unique_sort_order", {
    unique: ["project_id", "sort_order"],
  });
}

export async function down(pgm) {
  pgm.dropTable("project_spaces");
  pgm.dropTable("projects");
  pgm.dropType("space_type");
}
