export async function up(pgm) {
  pgm.addColumns("project_spaces", {
    deleted_at: { type: "timestamptz" },
  });
  pgm.dropConstraint("project_spaces", "project_spaces_unique_name");
  pgm.dropConstraint("project_spaces", "project_spaces_unique_sort_order");
  pgm.createIndex("project_spaces", ["project_id", "display_name"], {
    name: "project_spaces_active_unique_name",
    unique: true,
    where: "deleted_at IS NULL",
  });
  pgm.createIndex("project_spaces", ["project_id", "sort_order"], {
    name: "project_spaces_active_unique_sort_order",
    unique: true,
    where: "deleted_at IS NULL",
  });
  pgm.createIndex("project_spaces", ["project_id", "deleted_at"], {
    name: "project_spaces_project_deleted_at",
  });
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM project_spaces WHERE deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION '存在已软删除空间，无法安全回滚空间软删除迁移';
      END IF;
    END;
    $$
  `);
  pgm.dropIndex("project_spaces", ["project_id", "deleted_at"], {
    name: "project_spaces_project_deleted_at",
  });
  pgm.dropIndex("project_spaces", ["project_id", "sort_order"], {
    name: "project_spaces_active_unique_sort_order",
  });
  pgm.dropIndex("project_spaces", ["project_id", "display_name"], {
    name: "project_spaces_active_unique_name",
  });
  pgm.addConstraint("project_spaces", "project_spaces_unique_name", {
    unique: ["project_id", "display_name"],
  });
  pgm.addConstraint("project_spaces", "project_spaces_unique_sort_order", {
    unique: ["project_id", "sort_order"],
  });
  pgm.dropColumns("project_spaces", ["deleted_at"]);
}
