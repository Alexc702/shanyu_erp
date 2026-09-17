import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import type { AuditRepository } from "../src/access/audit.repository";
import type { MainMaterialRepository } from "../src/main-material/main-material.repository";
import type {
  QuotationExportJob,
  QuotationExportJobRepository,
} from "../src/quotation/quotation-export-job.repository";
import type { QuotationExportStorage } from "../src/quotation/quotation-export.storage";
import { QuotationExportWorker } from "../src/quotation/quotation-export.worker";
import type { QuotationExporter } from "../src/quotation/quotation-exporter";
import type {
  QuotationDraft,
  QuotationRepository,
} from "../src/quotation/quotation.repository";

describe("QuotationExportWorker", () => {
  it("claims one job, stores the file, and completes it with metadata", async () => {
    const payload = await validPdfPayload("0.0000");
    const job = pendingJob();
    const complete = vi.fn(async () => ({
      ...job,
      completedAt: new Date(),
      exportId: "export-id",
      status: "SUCCEEDED" as const,
    }));
    const jobs = {
      claimNext: vi.fn(async () => job),
      complete,
      enqueue: vi.fn(),
      fail: vi.fn(),
      findById: vi.fn(),
    } as unknown as QuotationExportJobRepository;
    const audits = { append: vi.fn(async () => undefined) };
    const worker = new QuotationExportWorker(
      jobs,
      quotationRepository(),
      { getQuotationById: vi.fn(async () => null) } as unknown as MainMaterialRepository,
      audits as unknown as AuditRepository,
      {
        generate: vi.fn(async () => ({
          contentType: "application/pdf",
          fileName: "项目报价.pdf",
          payload,
        })),
      } as unknown as QuotationExporter,
      {
        remove: vi.fn(),
        save: vi.fn(async () => ({
          sizeBytes: payload.length,
          storagePath: "export-id.pdf",
        })),
      } as unknown as QuotationExportStorage,
    );

    await expect(worker.processNext()).resolves.toBe(true);
    expect(complete).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        contentType: "application/pdf",
        sha256: createHash("sha256").update(payload).digest("hex"),
        sizeBytes: payload.length,
        storagePath: "export-id.pdf",
      }),
    );
    expect(audits.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "QUOTATION_EXPORTED", result: "SUCCESS" }),
    );
  });

  it("marks the job failed when rendering throws", async () => {
    const job = pendingJob();
    const fail = vi.fn(async (_id: string, message: string) => ({
      ...job,
      completedAt: new Date(),
      errorMessage: message,
      status: "FAILED" as const,
    }));
    const jobs = {
      claimNext: vi.fn(async () => job),
      complete: vi.fn(),
      enqueue: vi.fn(),
      fail,
      findById: vi.fn(),
    } as unknown as QuotationExportJobRepository;
    const worker = new QuotationExportWorker(
      jobs,
      quotationRepository(),
      { getQuotationById: vi.fn(async () => null) } as unknown as MainMaterialRepository,
      { append: vi.fn(async () => undefined) } as unknown as AuditRepository,
      {
        generate: vi.fn(async () => {
          throw new Error("字体损坏");
        }),
      } as unknown as QuotationExporter,
      { remove: vi.fn(), save: vi.fn() } as unknown as QuotationExportStorage,
    );

    await expect(worker.processNext()).resolves.toBe(true);
    expect(fail).toHaveBeenCalledWith(job.id, "导出失败：字体损坏");
  });

  it("rejects an incomplete PDF before storing an export record", async () => {
    const job = pendingJob();
    const fail = vi.fn(async (_id: string, message: string) => ({
      ...job,
      completedAt: new Date(),
      errorMessage: message,
      status: "FAILED" as const,
    }));
    const save = vi.fn();
    const worker = new QuotationExportWorker(
      {
        claimNext: vi.fn(async () => job),
        complete: vi.fn(),
        enqueue: vi.fn(),
        fail,
        findById: vi.fn(),
      } as unknown as QuotationExportJobRepository,
      quotationRepository(),
      { getQuotationById: vi.fn(async () => null) } as unknown as MainMaterialRepository,
      { append: vi.fn(async () => undefined) } as unknown as AuditRepository,
      {
        generate: vi.fn(async () => ({
          contentType: "application/pdf",
          fileName: "项目报价.pdf",
          payload: await validPdfPayload("0.0000", 1),
        })),
      } as unknown as QuotationExporter,
      { remove: vi.fn(), save } as unknown as QuotationExportStorage,
    );

    await expect(worker.processNext()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(job.id, "导出失败：生成的 PDF 页数不足");
  });
});

function pendingJob(): QuotationExportJob {
  return {
    attempts: 1,
    audience: "CLIENT",
    completedAt: null,
    createdAt: new Date(),
    errorMessage: null,
    exportId: null,
    format: "PDF",
    id: "job-id",
    quotationId: "quotation-id",
    requestedByUserId: "user-id",
    startedAt: new Date(),
    status: "RUNNING",
  };
}

function quotationRepository(): QuotationRepository {
  return {
    findById: vi.fn(async () => ({
      adjustmentStatus: "AWAITING_SUBMISSION",
      directCost: "0.0000",
      discountRate: "1.0000",
      id: "quotation-id",
      isCurrent: true,
      managementFee: "0.0000",
      projectId: "project-id",
      status: "QUOTED",
    } as QuotationDraft)),
    findProject: vi.fn(async () => ({
      customerName: "林先生",
      id: "project-id",
    })),
  } as unknown as QuotationRepository;
}

async function validPdfPayload(
  grandTotal: string,
  pageCount = 4,
): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setSubject(`grand-total:${grandTotal}`);
  for (let page = 0; page < pageCount; page += 1) document.addPage();
  return Buffer.from(await document.save());
}
