import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  CatalogImportBatchSummary,
  CatalogImportResponse,
  PublishedHalfPackageCatalogResponse,
  PublishedHalfPackageCatalogView,
} from "@shanyu/contracts";

import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import type { CatalogImportBatchResult } from "./catalog.service";
import { CatalogService } from "./catalog.service";

interface UploadedWorkbook {
  readonly buffer: Buffer;
  readonly originalname: string;
}

@Controller("catalog/half-package")
export class CatalogController {
  constructor(
    private readonly authService: AuthService,
    private readonly catalogService: CatalogService,
  ) {}

  @Post("imports")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async validateWorkbook(
    @Headers("cookie") cookieHeader: string | undefined,
    @UploadedFile() file: UploadedWorkbook | undefined,
  ): Promise<CatalogImportResponse> {
    const actor = await this.currentUser(cookieHeader);
    if (!file) {
      throw new BadRequestException("请选择要校验的 Excel 文件");
    }
    const batch = await this.catalogService.validateWorkbook(actor, {
      buffer: file.buffer,
      fileName: file.originalname,
    });
    return { batch: toBatchSummary(batch) };
  }

  @Post("imports/:batchId/publish")
  async publish(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("batchId") batchId: string,
  ): Promise<PublishedHalfPackageCatalogResponse> {
    const actor = await this.currentUser(cookieHeader);
    const catalog = await this.catalogService.publishBatch(actor, batchId);
    return { catalog: toPublishedCatalog(catalog) };
  }

  @Get("published")
  async getPublished(
    @Headers("cookie") cookieHeader?: string,
  ): Promise<PublishedHalfPackageCatalogResponse> {
    const actor = await this.currentUser(cookieHeader);
    const catalog = await this.catalogService.getPublishedCatalog(actor);
    return { catalog: toPublishedCatalog(catalog) };
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}

function toBatchSummary(
  batch: CatalogImportBatchResult,
): CatalogImportBatchSummary {
  return {
    createdAt: batch.createdAt.toISOString(),
    fileName: batch.fileName,
    id: batch.id,
    publishedVersionId: batch.publishedVersionId,
    reused: batch.reused,
    status: batch.status,
    validation: batch.validation,
  };
}

function toPublishedCatalog(
  catalog: Awaited<ReturnType<CatalogService["getPublishedCatalog"]>>,
): PublishedHalfPackageCatalogView {
  return {
    ...catalog,
    publishedAt: catalog.publishedAt.toISOString(),
  };
}
