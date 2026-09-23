import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type {
  CreateHalfPackageExportRequest,
  DecideHalfPackageQuotationRequest,
  HalfPackageApprovalListResponse,
  HalfPackageCostMarginResponse,
  HalfPackageExportResponse,
  HalfPackageQuotationResponse,
  HalfPackageQuotationVersionsResponse,
  HalfPackageSubmissionCheckResponse,
  HalfPackageVersionCompareResponse,
  ProjectCostAnalysisResponse,
  SubmitHalfPackageQuotationRequest,
  UpdateHalfPackageAdjustmentRequest,
  UpdateHalfPackageMarginBenchmarkRequest,
  UpdateHalfPackageQuotationLineRequest,
} from "@shanyu/contracts";
import type { Response } from "express";

import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import { QuotationService } from "./quotation.service";
import type { QuotationExportJob } from "./quotation-export-job.repository";
import { QuotationExportStorage } from "./quotation-export.storage";
import type { QuotationExportRecord } from "./quotation.repository";

@Controller("projects/:projectId/half-package-quotation")
export class QuotationController {
  constructor(
    private readonly authService: AuthService,
    private readonly quotationService: QuotationService,
  ) {}

  @Get("cost-margin")
  async getCostMargin(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<HalfPackageCostMarginResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      costMargin: await this.quotationService.getCostMargin(actor, projectId),
    };
  }

  @Get("project-cost-analysis")
  async getProjectCostAnalysis(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Query("quotationId") quotationId?: string,
  ): Promise<ProjectCostAnalysisResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      analysis: await this.quotationService.getProjectCostAnalysis(
        actor,
        projectId,
        quotationId,
      ),
    };
  }

  @Get("submission-check")
  async checkSubmission(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<HalfPackageSubmissionCheckResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      check: await this.quotationService.checkSubmission(actor, projectId),
    };
  }

  @Post("submit")
  async submit(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageQuotationResponse> {
    const input = submitInput(body);
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.submit(
        actor,
        projectId,
        input.expectedRevision,
      ),
    };
  }

  @Get("versions")
  async listVersions(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<HalfPackageQuotationVersionsResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      versions: await this.quotationService.listVersions(actor, projectId),
    };
  }

  @Get("versions/compare")
  async compareVersions(
    @Headers("cookie") cookieHeader: string | undefined,
    @Query("from") fromId: string | undefined,
    @Query("to") toId: string | undefined,
  ): Promise<HalfPackageVersionCompareResponse> {
    if (!fromId || !toId) {
      throw new BadRequestException("版本对比参数不完整");
    }
    const actor = await this.currentUser(cookieHeader);
    return this.quotationService.compareVersions(actor, fromId, toId);
  }

  @Post("versions/:quotationId/continue-editing")
  async continueEditing(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<HalfPackageQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.continueEditing(actor, quotationId),
    };
  }

  @Patch("versions/:quotationId/adjustment")
  async updateAdjustment(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.updateAdjustment(
        actor,
        quotationId,
        adjustmentInput(body),
      ),
    };
  }

  @Patch("design-fee")
  async updateDesignFee(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageQuotationResponse> {
    const input = body as Record<string, unknown> | null;
    if (!input || typeof input.quotationId !== "string" || typeof input.unitPrice !== "string" || typeof input.expectedRevision !== "number") {
      throw new BadRequestException("设计费信息不完整");
    }
    return { quotation: await this.quotationService.updateDesignFee(await this.currentUser(cookieHeader), projectId, input.unitPrice, input.expectedRevision, input.quotationId) };
  }

  @Patch("versions/:quotationId/margin-benchmark")
  async updateMarginBenchmark(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("quotationId") quotationId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageCostMarginResponse> {
    const input = marginBenchmarkInput(body);
    const actor = await this.currentUser(cookieHeader);
    return {
      costMargin: await this.quotationService.updateMarginBenchmark(
        actor,
        projectId,
        quotationId,
        input.marginBenchmarkPercent,
      ),
    };
  }

  @Get()
  async getOrCreateDraft(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<HalfPackageQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.getOrCreateDraft(actor, projectId),
    };
  }

  @Patch("lines/:lineId")
  async updateLine(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageQuotationResponse> {
    const input = updateLineInput(body);
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.updateLine(
        actor,
        projectId,
        lineId,
        input,
      ),
    };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

@Controller("approvals/half-package")
export class QuotationApprovalController {
  constructor(
    private readonly authService: AuthService,
    private readonly quotationService: QuotationService,
  ) {}

  @Get()
  async list(
    @Headers("cookie") cookieHeader: string | undefined,
  ): Promise<HalfPackageApprovalListResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotations: await this.quotationService.listPendingApprovals(actor),
    };
  }

  @Get(":quotationId")
  async get(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<HalfPackageQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.getVersion(actor, quotationId),
    };
  }

  @Get(":quotationId/cost-margin")
  async getCostMargin(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<HalfPackageCostMarginResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      costMargin: await this.quotationService.getVersionCostMargin(
        actor,
        quotationId,
      ),
    };
  }

  @Post(":quotationId/decision")
  async decide(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageQuotationResponse> {
    const input = decisionInput(body);
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.decide(
        actor,
        quotationId,
        input.action,
        input.reason,
      ),
    };
  }

  @Post(":quotationId/exports")
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageExportResponse> {
    const input = exportInput(body);
    const actor = await this.currentUser(cookieHeader);
    const job = await this.quotationService.requestExport(
      actor,
      quotationId,
      input.format,
      input.audience ?? "CLIENT",
    );
    const exported = job.exportId
      ? await this.quotationService.getExport(actor, job.exportId)
      : null;
    return {
      job: exportJobResponse(job, exported),
    };
  }

  @Post(":quotationId/selection-sheet")
  @HttpCode(HttpStatus.ACCEPTED)
  async createSelectionSheet(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<HalfPackageExportResponse> {
    const actor = await this.currentUser(cookieHeader);
    const job = await this.quotationService.requestSelectionSheet(actor, quotationId);
    return { job: exportJobResponse(job, null) };
  }

  @Get(":quotationId/selection-sheet")
  async latestSelectionSheet(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<{ job: HalfPackageExportResponse["job"] | null }> {
    const actor = await this.currentUser(cookieHeader);
    const job = await this.quotationService.getLatestSelectionSheet(actor, quotationId);
    const exported = job?.exportId ? await this.quotationService.getExport(actor, job.exportId) : null;
    return { job: job ? exportJobResponse(job, exported) : null };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

@Controller("quotation-export-jobs")
export class QuotationExportJobController {
  constructor(
    private readonly authService: AuthService,
    private readonly quotationService: QuotationService,
  ) {}

  @Get(":jobId")
  async get(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("jobId") jobId: string,
  ): Promise<HalfPackageExportResponse> {
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    const job = await this.quotationService.getExportJob(actor, jobId);
    const exported = job.exportId
      ? await this.quotationService.getExport(actor, job.exportId)
      : null;
    return { job: exportJobResponse(job, exported) };
  }
}

@Controller("quotation-exports")
export class QuotationExportController {
  constructor(
    private readonly authService: AuthService,
    private readonly quotationService: QuotationService,
    private readonly exportStorage: QuotationExportStorage,
  ) {}

  @Get(":exportId")
  async download(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("exportId") exportId: string,
    @Res() response: Response,
  ): Promise<void> {
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    const exported = await this.quotationService.getExport(actor, exportId);
    response.setHeader("content-type", exported.contentType);
    response.setHeader(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
    );
    if ("payload" in exported) {
      response.send(exported.payload);
      return;
    }
    response.setHeader("content-length", String(exported.sizeBytes));
    await new Promise<void>((resolve, reject) => {
      const stream = this.exportStorage.open(exported.storagePath);
      stream.once("error", reject);
      response.once("finish", resolve);
      response.once("close", resolve);
      stream.pipe(response);
    });
  }
}

function exportJobResponse(
  job: QuotationExportJob,
  exported: QuotationExportRecord | null,
): HalfPackageExportResponse["job"] {
  return {
    audience: job.audience,
    errorMessage: job.errorMessage,
    export: exported
      ? {
          audience: exported.audience,
          downloadPath: `/quotation-exports/${exported.id}`,
          fileName: exported.fileName,
          format: exported.format,
          id: exported.id,
          sha256: exported.sha256,
        }
      : null,
    format: job.format,
    id: job.id,
    status: job.status,
    statusPath: `/quotation-export-jobs/${job.id}`,
  };
}

function updateLineInput(body: unknown): UpdateHalfPackageQuotationLineRequest {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("报价工程项保存信息不完整");
  }
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.expectedRevision !== "number" ||
    typeof candidate.selected !== "boolean" ||
    (candidate.quantity !== null && typeof candidate.quantity !== "string")
  ) {
    throw new BadRequestException("报价工程项保存信息不完整");
  }
  return {
    expectedRevision: candidate.expectedRevision,
    quantity: candidate.quantity,
    selected: candidate.selected,
  };
}

function submitInput(body: unknown): SubmitHalfPackageQuotationRequest {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !Number.isInteger(candidate.expectedRevision) ||
    Number(candidate.expectedRevision) < 0
  ) {
    throw new BadRequestException("提交信息不完整");
  }
  return { expectedRevision: Number(candidate.expectedRevision) };
}

function adjustmentInput(body: unknown): UpdateHalfPackageAdjustmentRequest {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !["SUBMIT_FOR_APPROVAL", "CONFIRM"].includes(String(candidate.action)) ||
    typeof candidate.discountRate !== "string" ||
    typeof candidate.writeOff !== "string" ||
    (candidate.reason !== null && typeof candidate.reason !== "string") ||
    typeof candidate.expectedRevision !== "number"
  ) {
    throw new BadRequestException("折扣与抹零信息不完整");
  }
  const material = candidate.mainMaterialAdjustment as Record<string, unknown> | undefined;
  if (material !== undefined && (!material || typeof material.discountRate !== "string" || typeof material.writeOff !== "string")) {
    throw new BadRequestException("主材折扣与抹零信息不完整");
  }
  return {
    ...(material ? { mainMaterialAdjustment: { discountRate: material.discountRate as string, writeOff: material.writeOff as string } } : {}),
    action: candidate.action as UpdateHalfPackageAdjustmentRequest["action"],
    discountRate: candidate.discountRate,
    expectedRevision: candidate.expectedRevision,
    reason: candidate.reason as string | null,
    writeOff: candidate.writeOff,
  };
}

function marginBenchmarkInput(
  body: unknown,
): UpdateHalfPackageMarginBenchmarkRequest {
  const candidate = body as Record<string, unknown> | null;
  if (!candidate || typeof candidate.marginBenchmarkPercent !== "string") {
    throw new BadRequestException("基准毛利率信息不完整");
  }
  return { marginBenchmarkPercent: candidate.marginBenchmarkPercent };
}

function decisionInput(body: unknown): DecideHalfPackageQuotationRequest {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !["APPROVED", "RETURNED"].includes(String(candidate.action)) ||
    (candidate.reason !== null && typeof candidate.reason !== "string")
  ) {
    throw new BadRequestException("审批信息不完整");
  }
  return {
    action: candidate.action as DecideHalfPackageQuotationRequest["action"],
    reason: candidate.reason as string | null,
  };
}

function exportInput(body: unknown): CreateHalfPackageExportRequest {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !["PDF", "XLSX"].includes(String(candidate.format)) ||
    !(candidate.audience === undefined || candidate.audience === "CLIENT" || candidate.audience === "INTERNAL")
  ) {
    throw new BadRequestException("导出格式仅支持 PDF 或 XLSX");
  }
  return {
    audience: candidate.audience as CreateHalfPackageExportRequest["audience"],
    format: candidate.format as CreateHalfPackageExportRequest["format"],
  };
}
