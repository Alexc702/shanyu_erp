import {
  BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Param, Patch,
  Post, Query, Res, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  MainMaterialCategoryCode, MainMaterialImportMode, MainMaterialImportResponse,
  MainMaterialCatalogUpdateCheckResponse, MainMaterialQuotationResponse,
  PublishedMainMaterialCatalogResponse,
} from "@shanyu/contracts";
import type { Response } from "express";

import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import { MainMaterialService } from "./main-material.service";

interface UploadedWorkbook {
  readonly buffer: Buffer;
  readonly originalname: string;
}

@Controller("catalog/main-materials")
export class MainMaterialCatalogController {
  constructor(
    private readonly authService: AuthService,
    private readonly mainMaterialService: MainMaterialService,
  ) {}

  @Get("published")
  async getPublished(
    @Headers("cookie") cookieHeader: string | undefined,
    @Query("category") categoryCode?: string,
    @Query("q") query?: string,
    @Query("spec") spec?: string,
  ): Promise<PublishedMainMaterialCatalogResponse> {
    const actor = await this.currentUser(cookieHeader);
    return { catalog: await this.mainMaterialService.getPublishedCatalog(actor, { categoryCode, query, spec }) };
  }

  @Get("assets/:assetId")
  async asset(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("assetId") assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    const actor = await this.currentUser(cookieHeader);
    const asset = await this.mainMaterialService.readAsset(actor, assetId);
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("Cache-Control", "private, max-age=86400, immutable");
    response.setHeader("Content-Disposition", `inline; filename="${asset.fileName}"`);
    response.send(asset.payload);
  }

  @Post("imports")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async validateWorkbook(
    @Headers("cookie") cookieHeader: string | undefined,
    @UploadedFile() file: UploadedWorkbook | undefined,
    @Body("mode") rawMode: string | undefined,
  ): Promise<MainMaterialImportResponse> {
    if (!file) throw new BadRequestException("请选择要校验的 Excel 文件");
    const actor = await this.currentUser(cookieHeader);
    return {
      batch: await this.mainMaterialService.validateWorkbook(actor, {
        buffer: file.buffer,
        fileName: file.originalname,
        mode: importMode(rawMode),
      }),
    };
  }

  @Post("online-edits")
  async validateOnlineEdit(
    @Headers("cookie") cookieHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<MainMaterialImportResponse> {
    const actor = await this.currentUser(cookieHeader);
    const input = onlineEditInput(body);
    return { batch: await this.mainMaterialService.validateOnlineEdit(actor, input) };
  }

  @Post("imports/:batchId/publish")
  async publish(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("batchId") batchId: string,
  ): Promise<PublishedMainMaterialCatalogResponse> {
    const actor = await this.currentUser(cookieHeader);
    return { catalog: await this.mainMaterialService.publishBatch(actor, batchId) };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

@Controller("projects/:projectId/main-material-quotation")
export class MainMaterialQuotationController {
  constructor(
    private readonly authService: AuthService,
    private readonly mainMaterialService: MainMaterialService,
  ) {}

  @Get()
  async get(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return { quotation: await this.mainMaterialService.getQuotation(actor, projectId) };
  }

  @Get("catalog")
  async getCatalog(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<PublishedMainMaterialCatalogResponse> {
    const actor = await this.currentUser(cookieHeader);
    return { catalog: await this.mainMaterialService.getQuotationCatalog(actor, projectId) };
  }

  @Get("versions/:quotationId")
  async getVersion(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("quotationId") quotationId: string,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    const quotation = await this.mainMaterialService.getVersion(actor, quotationId);
    if (!quotation || quotation.projectId !== projectId) {
      throw new NotFoundException("主材报价版本不存在");
    }
    return { quotation };
  }

  @Get("catalog-update")
  async checkCatalogUpdate(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<MainMaterialCatalogUpdateCheckResponse> {
    const actor = await this.currentUser(cookieHeader);
    return { check: await this.mainMaterialService.checkCatalogUpdate(actor, projectId) };
  }

  @Post("catalog-update")
  async refreshCatalog(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    const expectedRevision = record(body).expectedRevision;
    if (typeof expectedRevision !== "number") {
      throw new BadRequestException("修订号格式不正确");
    }
    return {
      quotation: await this.mainMaterialService.refreshCatalog(
        actor, projectId, expectedRevision,
      ),
    };
  }

  @Patch("lines/:lineId")
  async select(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.mainMaterialService.selectLine(
        actor, projectId, lineId, selectionInput(body, true),
      ),
    };
  }

  @Patch("lines/:lineId/demand")
  async updateDemand(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    const value = record(body);
    if (
      typeof value.baseQuantity !== "string" ||
      typeof value.lossRate !== "string" ||
      typeof value.expectedRevision !== "number"
    ) {
      throw new BadRequestException("主材需求数量信息不完整");
    }
    return {
      quotation: await this.mainMaterialService.updateDemandLine(
        actor,
        projectId,
        lineId,
        {
          baseQuantity: value.baseQuantity,
          expectedRevision: value.expectedRevision,
          lossRate: value.lossRate,
        },
      ),
    };
  }

  @Post("lines")
  async add(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    const input = selectionInput(body, false);
    const categoryCode = record(body).categoryCode;
    if (typeof categoryCode !== "string") throw new BadRequestException("主材分类不能为空");
    return {
      quotation: await this.mainMaterialService.addManualLine(actor, projectId, {
        ...input,
        categoryCode: categoryCode as MainMaterialCategoryCode,
        quantity: input.quantity ?? "",
      }),
    };
  }

  @Delete("lines/:lineId")
  async remove(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("lineId") lineId: string,
    @Query("expectedRevision") rawRevision: string | undefined,
  ): Promise<MainMaterialQuotationResponse> {
    const actor = await this.currentUser(cookieHeader);
    return {
      quotation: await this.mainMaterialService.removeManualLine(
        actor, projectId, lineId, Number(rawRevision),
      ),
    };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

function importMode(value: string | undefined): MainMaterialImportMode {
  if (value === "FULL" || value === "DELTA") return value;
  throw new BadRequestException("导入模式仅支持 FULL 或 DELTA");
}

function selectionInput(body: unknown, quantityOptional: boolean) {
  const value = record(body);
  if (
    typeof value.itemVersionId !== "string" ||
    typeof value.expectedRevision !== "number" ||
    !(value.color === null || typeof value.color === "string") ||
    !(value.quantity === undefined || typeof value.quantity === "string") ||
    (!quantityOptional && typeof value.quantity !== "string")
  ) {
    throw new BadRequestException("主材选型信息不完整");
  }
  return {
    color: value.color,
    expectedRevision: value.expectedRevision,
    itemVersionId: value.itemVersionId,
    ...(typeof value.quantity === "string" ? { quantity: value.quantity } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求正文格式不正确");
  }
  return value as Record<string, unknown>;
}

function onlineEditInput(body: unknown) {
  const value = record(body);
  const values = record(value.values);
  if (
    typeof value.materialId !== "string" ||
    typeof value.expectedRecordVersion !== "number" ||
    typeof value.changeReason !== "string" ||
    !(value.operation === "UPSERT" || value.operation === "DEACTIVATE" || value.operation === "REACTIVATE") ||
    Object.values(values).some((field) => !(field === null || typeof field === "string"))
  ) {
    throw new BadRequestException("线上维护信息不完整");
  }
  return {
    changeReason: value.changeReason,
    expectedRecordVersion: value.expectedRecordVersion,
    materialId: value.materialId,
    operation: value.operation as "UPSERT" | "DEACTIVATE" | "REACTIVATE",
    values: values as Record<string, string | null>,
  };
}
