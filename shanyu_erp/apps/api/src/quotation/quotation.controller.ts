import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  SubmitHalfPackageQuotationRequest,
  UpdateHalfPackageQuotationLineRequest,
} from "@shanyu/contracts";
import type { Response } from "express";

import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import { QuotationService } from "./quotation.service";

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

  @Post("versions/:quotationId/clone")
  async cloneVersion(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
  ): Promise<HalfPackageQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.quotationService.cloneVersion(actor, quotationId),
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
  async createExport(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("quotationId") quotationId: string,
    @Body() body: unknown,
  ): Promise<HalfPackageExportResponse> {
    const input = exportInput(body);
    const actor = await this.currentUser(cookieHeader);
    const created = await this.quotationService.createExport(
      actor,
      quotationId,
      input.format,
    );
    return {
      export: {
        downloadPath: `/quotation-exports/${created.id}`,
        fileName: created.fileName,
        format: created.format,
        id: created.id,
        sha256: created.sha256,
      },
    };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

@Controller("quotation-exports")
export class QuotationExportController {
  constructor(
    private readonly authService: AuthService,
    private readonly quotationService: QuotationService,
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
    response.send(exported.payload);
  }
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

function decisionInput(body: unknown): DecideHalfPackageQuotationRequest {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !["APPROVED", "SPECIAL_APPROVED", "RETURNED"].includes(
      String(candidate.action),
    ) ||
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
  if (!candidate || !["PDF", "XLSX"].includes(String(candidate.format))) {
    throw new BadRequestException("导出格式仅支持 PDF 或 XLSX");
  }
  return { format: candidate.format as CreateHalfPackageExportRequest["format"] };
}
