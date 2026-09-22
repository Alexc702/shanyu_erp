import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { renderSelectionSheet } from "./selection-sheet";
import { readSelectionSheetImage } from "./selection-sheet-images";

import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../access/audit.repository";
import {
  MAIN_MATERIAL_REPOSITORY,
  type MainMaterialRepository,
} from "../main-material/main-material.repository";
import {
  QUOTATION_EXPORT_JOB_REPOSITORY,
  type QuotationExportJob,
  type QuotationExportJobRepository,
} from "./quotation-export-job.repository";
import { QuotationExportStorage } from "./quotation-export.storage";
import {
  buildQuotationExportSummary,
  type GeneratedQuotationExport,
  QuotationExporter,
} from "./quotation-exporter";
import {
  QUOTATION_REPOSITORY,
  type QuotationDraft,
  type QuotationRepository,
} from "./quotation.repository";

@Injectable()
export class QuotationExportWorker {
  private readonly logger = new Logger(QuotationExportWorker.name);
  private stopped = false;

  constructor(
    @Inject(QUOTATION_EXPORT_JOB_REPOSITORY)
    private readonly jobs: QuotationExportJobRepository,
    @Inject(QUOTATION_REPOSITORY)
    private readonly quotations: QuotationRepository,
    @Inject(MAIN_MATERIAL_REPOSITORY)
    private readonly mainMaterials: MainMaterialRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly audits: AuditRepository,
    private readonly exporter: QuotationExporter,
    private readonly storage: QuotationExportStorage,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        if (!(await this.processNext())) await wait(500);
      } catch (error) {
        this.logger.error("导出 Worker 轮询失败", errorStack(error));
        await wait(1_000);
      }
    }
  }

  async processNext(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;
    let storagePath: string | null = null;
    try {
      const quotation = await this.quotations.findById(job.quotationId);
      if (!quotation || !isExportable(quotation)) {
        throw new Error("报价状态已变化，请重新发起导出");
      }
      const project = await this.quotations.findProject(quotation.projectId);
      if (!project) throw new Error("导出关联的项目不存在");
      const mainMaterial = await this.mainMaterials.getQuotationById(quotation.id);
      const generated = job.documentKind === "SELECTION" && job.selectionSnapshot
        ? await renderSelectionSheet(job.selectionSnapshot, id => readSelectionSheetImage(this.mainMaterials, id))
        : await this.exporter.generate(
        quotation,
        job.format,
        project.customerName,
        mainMaterial,
        job.audience,
      );
      if (job.documentKind === "SELECTION") {
        if (!job.selectionSnapshot || generated.payload.length === 0 || (await PDFDocument.load(generated.payload)).getPageCount() < 2) throw new Error("选材单文件校验失败");
      } else await validateGeneratedExport(
        generated,
        job.format,
        buildQuotationExportSummary(quotation, mainMaterial).grandTotal,
      );
      const exportId = randomUUID();
      const saved = await this.storage.save(exportId, job.format, generated.payload);
      storagePath = saved.storagePath;
      const completed = await this.jobs.complete(job.id, {
        audience: job.audience,
        contentType: generated.contentType,
        createdAt: new Date(),
        createdByUserId: job.requestedByUserId,
        fileName: generated.fileName,
        format: job.format,
        id: exportId,
        quotationId: job.quotationId,
        sha256: createHash("sha256").update(generated.payload).digest("hex"),
        sizeBytes: saved.sizeBytes,
        storagePath: saved.storagePath,
      });
      await this.appendSuccessAudit(job, completed.exportId ?? exportId).catch(
        (error: unknown) => {
          this.logger.error("导出成功审计写入失败", errorStack(error));
        },
      );
      return true;
    } catch (error) {
      if (storagePath) {
        await this.storage.remove(storagePath).catch((removeError: unknown) => {
          this.logger.error("导出失败文件清理失败", errorStack(removeError));
        });
      }
      const message = exportErrorMessage(error);
      await this.jobs.fail(job.id, message);
      await this.appendFailureAudit(job, message).catch((auditError: unknown) => {
        this.logger.error("导出失败审计写入失败", errorStack(auditError));
      });
      return true;
    }
  }

  private async appendSuccessAudit(
    job: QuotationExportJob,
    exportId: string,
  ): Promise<void> {
    await this.audits.append({
      action: "QUOTATION_EXPORTED",
      actorUserId: job.requestedByUserId,
      metadata: { audience: job.audience, format: job.format, jobId: job.id },
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: exportId,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
  }

  private async appendFailureAudit(
    job: QuotationExportJob,
    message: string,
  ): Promise<void> {
    await this.audits.append({
      action: "QUOTATION_EXPORTED",
      actorUserId: job.requestedByUserId,
      metadata: { audience: job.audience, format: job.format, jobId: job.id },
      occurredAt: new Date(),
      reason: message,
      result: "FAILURE",
      targetId: job.id,
      targetType: "HALF_PACKAGE_QUOTATION",
    });
  }
}

function isExportable(quotation: QuotationDraft): boolean {
  return quotation.isCurrent && (
    (quotation.status === "QUOTED" &&
      quotation.adjustmentStatus === "AWAITING_SUBMISSION") ||
    (quotation.status === "APPROVED" &&
      quotation.adjustmentStatus === "CONFIRMED")
  );
}

function exportErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  return `导出失败：${message}`.slice(0, 500);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

async function validateGeneratedExport(
  generated: GeneratedQuotationExport,
  format: QuotationExportJob["format"],
  expectedGrandTotal: string,
): Promise<void> {
  if (generated.payload.length === 0) {
    throw new Error("生成的导出文件为空");
  }
  if (format === "XLSX") {
    if (generated.payload.subarray(0, 2).toString("ascii") !== "PK") {
      throw new Error("生成的 Excel 文件格式无效");
    }
    return;
  }
  if (generated.payload.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("生成的 PDF 文件格式无效");
  }
  const document = await PDFDocument.load(generated.payload, {
    updateMetadata: false,
  });
  if (document.getPageCount() < 4) {
    throw new Error("生成的 PDF 页数不足");
  }
  if (document.getSubject() !== `grand-total:${expectedGrandTotal}`) {
    throw new Error("生成的 PDF 总金额校验失败");
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
