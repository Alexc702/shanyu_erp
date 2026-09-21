export async function up(pgm) {
  pgm.sql(`ALTER TABLE quotation_export_jobs
    ADD COLUMN document_kind text NOT NULL DEFAULT 'QUOTATION' CHECK(document_kind IN ('QUOTATION','SELECTION')),
    ADD COLUMN selection_snapshot jsonb,
    ADD CONSTRAINT selection_snapshot_required CHECK ((document_kind = 'QUOTATION' AND selection_snapshot IS NULL) OR (document_kind = 'SELECTION' AND selection_snapshot IS NOT NULL AND format = 'PDF' AND audience = 'CLIENT'));
    DROP INDEX quotation_export_jobs_active_unique;
    CREATE UNIQUE INDEX quotation_export_jobs_active_unique ON quotation_export_jobs (quotation_id, format, audience, document_kind) WHERE status IN ('PENDING', 'RUNNING');`);
}
export async function down() { throw new Error("选材单任务快照不可破坏性回滚"); }
