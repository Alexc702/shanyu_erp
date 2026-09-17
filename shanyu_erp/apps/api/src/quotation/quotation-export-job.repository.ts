import { Injectable } from "@nestjs/common";

import { DatabaseClient } from "../database/database.client";
import type {
  QuotationExportFormat,
  StoredQuotationExport,
} from "./quotation.repository";

export const QUOTATION_EXPORT_JOB_REPOSITORY = Symbol(
  "QUOTATION_EXPORT_JOB_REPOSITORY",
);

export type QuotationExportJobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export interface QuotationExportJob {
  readonly attempts: number;
  readonly audience: "CLIENT" | "INTERNAL";
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly errorMessage: string | null;
  readonly exportId: string | null;
  readonly format: QuotationExportFormat;
  readonly id: string;
  readonly quotationId: string;
  readonly requestedByUserId: string;
  readonly startedAt: Date | null;
  readonly status: QuotationExportJobStatus;
}

export interface NewQuotationExportJob {
  readonly audience: "CLIENT" | "INTERNAL";
  readonly format: QuotationExportFormat;
  readonly id: string;
  readonly quotationId: string;
  readonly requestedByUserId: string;
}

export interface QuotationExportJobRepository {
  claimNext(): Promise<QuotationExportJob | null>;
  complete(
    jobId: string,
    exported: StoredQuotationExport & { readonly createdByUserId: string },
  ): Promise<QuotationExportJob>;
  enqueue(input: NewQuotationExportJob): Promise<QuotationExportJob>;
  fail(jobId: string, message: string): Promise<QuotationExportJob>;
  findById(jobId: string): Promise<QuotationExportJob | null>;
}

interface ExportJobRow {
  attempts: number;
  audience: "CLIENT" | "INTERNAL";
  completed_at: Date | null;
  created_at: Date;
  error_message: string | null;
  export_id: string | null;
  format: QuotationExportFormat;
  id: string;
  quotation_id: string;
  requested_by_user_id: string;
  started_at: Date | null;
  status: QuotationExportJobStatus;
}

const exportJobSelect = `SELECT id, quotation_id, format, audience,
       requested_by_user_id, status, attempts, export_id, error_message,
       created_at, started_at, completed_at
  FROM quotation_export_jobs`;

@Injectable()
export class PgQuotationExportJobRepository
  implements QuotationExportJobRepository {
  constructor(private readonly database: DatabaseClient) {}

  async enqueue(input: NewQuotationExportJob): Promise<QuotationExportJob> {
    return this.database.transaction(async (database) => {
      const inserted = await database.query<ExportJobRow>(
        `INSERT INTO quotation_export_jobs
           (id, quotation_id, format, audience, requested_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (quotation_id, format, audience)
           WHERE status IN ('PENDING', 'RUNNING')
         DO NOTHING
         RETURNING id, quotation_id, format, audience, requested_by_user_id,
                   status, attempts, export_id, error_message,
                   created_at, started_at, completed_at`,
        [
          input.id,
          input.quotationId,
          input.format,
          input.audience,
          input.requestedByUserId,
        ],
      );
      const created = inserted.rows[0];
      if (created) return toExportJob(created);
      const existing = await database.query<ExportJobRow>(
        `${exportJobSelect}
          WHERE quotation_id = $1 AND format = $2 AND audience = $3
            AND status IN ('PENDING', 'RUNNING')
          ORDER BY created_at
          LIMIT 1`,
        [input.quotationId, input.format, input.audience],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("并发导出任务创建后无法读取");
      return toExportJob(row);
    });
  }

  async findById(jobId: string): Promise<QuotationExportJob | null> {
    const result = await this.database.query<ExportJobRow>(
      `${exportJobSelect} WHERE id = $1`,
      [jobId],
    );
    return result.rows[0] ? toExportJob(result.rows[0]) : null;
  }

  async claimNext(): Promise<QuotationExportJob | null> {
    return this.database.transaction(async (database) => {
      await database.query(
        `UPDATE quotation_export_jobs
            SET status = 'FAILED', completed_at = current_timestamp,
                error_message = '导出 Worker 多次中断，请重新发起导出'
          WHERE status = 'RUNNING'
            AND started_at < current_timestamp - interval '10 minutes'
            AND attempts >= 3`,
      );
      await database.query(
        `UPDATE quotation_export_jobs
            SET status = 'PENDING', started_at = NULL
          WHERE status = 'RUNNING'
            AND started_at < current_timestamp - interval '10 minutes'
            AND attempts < 3`,
      );
      const result = await database.query<ExportJobRow>(
        `WITH next_job AS (
           SELECT id
             FROM quotation_export_jobs
            WHERE status = 'PENDING'
            ORDER BY CASE WHEN format = 'XLSX' THEN 0 ELSE 1 END,
                     created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE quotation_export_jobs job
            SET status = 'RUNNING', started_at = current_timestamp,
                attempts = attempts + 1, error_message = NULL
           FROM next_job
          WHERE job.id = next_job.id
         RETURNING job.id, job.quotation_id, job.format, job.audience,
                   job.requested_by_user_id, job.status, job.attempts,
                   job.export_id, job.error_message, job.created_at,
                   job.started_at, job.completed_at`,
      );
      return result.rows[0] ? toExportJob(result.rows[0]) : null;
    });
  }

  async complete(
    jobId: string,
    exported: StoredQuotationExport & { readonly createdByUserId: string },
  ): Promise<QuotationExportJob> {
    return this.database.transaction(async (database) => {
      await database.query(
        `INSERT INTO half_package_exports
           (id, quotation_id, format, audience, file_name, content_type,
            content_sha256, payload, storage_path, size_bytes,
            created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11)`,
        [
          exported.id,
          exported.quotationId,
          exported.format,
          exported.audience,
          exported.fileName,
          exported.contentType,
          exported.sha256,
          exported.storagePath,
          exported.sizeBytes,
          exported.createdByUserId,
          exported.createdAt,
        ],
      );
      const result = await database.query<ExportJobRow>(
        `UPDATE quotation_export_jobs
            SET status = 'SUCCEEDED', export_id = $2,
                completed_at = current_timestamp, error_message = NULL
          WHERE id = $1 AND status = 'RUNNING'
         RETURNING id, quotation_id, format, audience, requested_by_user_id,
                   status, attempts, export_id, error_message,
                   created_at, started_at, completed_at`,
        [jobId, exported.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error("导出任务完成状态冲突");
      return toExportJob(row);
    });
  }

  async fail(jobId: string, message: string): Promise<QuotationExportJob> {
    const result = await this.database.query<ExportJobRow>(
      `UPDATE quotation_export_jobs
          SET status = 'FAILED', completed_at = current_timestamp,
              error_message = $2, export_id = NULL
        WHERE id = $1 AND status = 'RUNNING'
       RETURNING id, quotation_id, format, audience, requested_by_user_id,
                 status, attempts, export_id, error_message,
                 created_at, started_at, completed_at`,
      [jobId, message],
    );
    const row = result.rows[0];
    if (!row) throw new Error("导出任务失败状态冲突");
    return toExportJob(row);
  }
}

function toExportJob(row: ExportJobRow): QuotationExportJob {
  return {
    attempts: row.attempts,
    audience: row.audience,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    errorMessage: row.error_message,
    exportId: row.export_id,
    format: row.format,
    id: row.id,
    quotationId: row.quotation_id,
    requestedByUserId: row.requested_by_user_id,
    startedAt: row.started_at,
    status: row.status,
  };
}
