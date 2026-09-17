export async function up(pgm) {
  pgm.addColumns("half_package_exports", {
    storage_path: { type: "text" },
    size_bytes: { type: "bigint" },
  });
  pgm.alterColumn("half_package_exports", "payload", { notNull: false });
  pgm.sql(`UPDATE half_package_exports
              SET size_bytes = octet_length(payload)
            WHERE payload IS NOT NULL`);
  pgm.addConstraint(
    "half_package_exports",
    "half_package_exports_storage_shape",
    {
      check:
        "(payload IS NOT NULL AND storage_path IS NULL AND size_bytes IS NOT NULL) OR " +
        "(payload IS NULL AND storage_path IS NOT NULL AND size_bytes IS NOT NULL AND size_bytes > 0)",
    },
  );

  pgm.createTable("quotation_export_jobs", {
    id: { type: "uuid", primaryKey: true },
    quotation_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quotations(id)",
      onDelete: "RESTRICT",
    },
    format: { type: "varchar(8)", notNull: true },
    audience: { type: "varchar(16)", notNull: true },
    requested_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    status: { type: "varchar(16)", notNull: true, default: "PENDING" },
    attempts: { type: "integer", notNull: true, default: 0 },
    export_id: {
      type: "uuid",
      references: "half_package_exports(id)",
      onDelete: "RESTRICT",
    },
    error_message: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
  });
  pgm.addConstraint("quotation_export_jobs", "quotation_export_jobs_format", {
    check: "format IN ('PDF', 'XLSX')",
  });
  pgm.addConstraint("quotation_export_jobs", "quotation_export_jobs_audience", {
    check: "audience IN ('CLIENT', 'INTERNAL')",
  });
  pgm.addConstraint("quotation_export_jobs", "quotation_export_jobs_status", {
    check: "status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')",
  });
  pgm.addConstraint("quotation_export_jobs", "quotation_export_jobs_result_shape", {
    check:
      "(status = 'PENDING' AND started_at IS NULL AND completed_at IS NULL AND export_id IS NULL) OR " +
      "(status = 'RUNNING' AND started_at IS NOT NULL AND completed_at IS NULL AND export_id IS NULL) OR " +
      "(status = 'SUCCEEDED' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND export_id IS NOT NULL AND error_message IS NULL) OR " +
      "(status = 'FAILED' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND export_id IS NULL AND error_message IS NOT NULL)",
  });
  pgm.createIndex("quotation_export_jobs", ["status", "created_at"]);
  pgm.sql(`CREATE UNIQUE INDEX quotation_export_jobs_active_unique
              ON quotation_export_jobs (quotation_id, format, audience)
           WHERE status IN ('PENDING', 'RUNNING')`);
}

export async function down(pgm) {
  pgm.dropTable("quotation_export_jobs");
  pgm.dropConstraint(
    "half_package_exports",
    "half_package_exports_storage_shape",
  );
  pgm.sql(`UPDATE half_package_exports
              SET payload = ''::bytea
            WHERE payload IS NULL`);
  pgm.alterColumn("half_package_exports", "payload", { notNull: true });
  pgm.dropColumns("half_package_exports", ["storage_path", "size_bytes"]);
}
