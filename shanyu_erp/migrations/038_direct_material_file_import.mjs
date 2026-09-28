export function up(pgm) {
  pgm.createTable("direct_material_import_blobs", {
    content_hash: { type: "char(64)", primaryKey: true },
    payload: { type: "bytea", notNull: true },
  });
  pgm.createTable("direct_material_imports", {
    id: { type: "uuid", primaryKey: true },
    batch_key: { type: "char(64)", notNull: true, unique: true },
    file_name: { type: "text", notNull: true },
    source: { type: "jsonb", notNull: true },
    information: { type: "jsonb", notNull: true, default: "{}" },
    revision: { type: "integer", notNull: true, default: 1 },
    preview_hash: { type: "char(64)", notNull: true },
    preview: { type: "jsonb", notNull: true },
    created_by_user_id: { type: "uuid", notNull: true, references: "users(id)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
  });
}
export function down(pgm) { pgm.dropTable("direct_material_imports"); pgm.dropTable("direct_material_import_blobs"); }
