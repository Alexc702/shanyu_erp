import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
} from "@nestjs/common";
import type {
  HalfPackageCostMarginResponse,
  HalfPackageQuotationResponse,
  UpdateHalfPackageQuotationLineRequest,
} from "@shanyu/contracts";

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
