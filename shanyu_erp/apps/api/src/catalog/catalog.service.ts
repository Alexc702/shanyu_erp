import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";
import { createHash, randomUUID } from "node:crypto";

import { AccessPolicy } from "../access/access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../access/audit.repository";
import {
  CATALOG_REPOSITORY,
  CatalogBatchStateError,
  type CatalogImportBatch,
  type CatalogRepository,
  type PublishedHalfPackageCatalog,
  type PublishedHalfPackageItem,
} from "./catalog.repository";
import {
  validateHalfPackageWorkbook,
} from "./half-package-workbook";

export interface CatalogWorkbookFile {
  readonly buffer: Buffer;
  readonly fileName: string;
}

export interface CatalogImportBatchResult extends CatalogImportBatch {
  readonly reused: boolean;
}

export interface PublishedCatalogView
  extends Omit<PublishedHalfPackageCatalog, "items"> {
  readonly items: readonly (
    | PublishedHalfPackageItem
    | Omit<PublishedHalfPackageItem, "costUnitPrice">
  )[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
  ) {}

  async validateWorkbook(
    actor: SessionUser,
    file: CatalogWorkbookFile,
  ): Promise<CatalogImportBatchResult> {
    this.accessPolicy.assertCanManageCatalog(actor);
    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.catalogRepository.findImportBatchByHash(fileHash);
    if (existing) {
      await this.appendAudit("CATALOG_IMPORT_REUSED", actor.id, existing.id);
      return { ...existing, reused: true };
    }

    let validation: Awaited<ReturnType<typeof validateHalfPackageWorkbook>>;
    try {
      validation = await validateHalfPackageWorkbook(file.buffer);
    } catch {
      throw new BadRequestException("无法读取 Excel 文件");
    }
    const batch = await this.catalogRepository.createImportBatch({
      createdByUserId: actor.id,
      fileHash,
      fileName: file.fileName,
      id: randomUUID(),
      items: validation.items,
      sections: validation.sections,
      status: validation.blockers.length === 0 ? "VALIDATED" : "FAILED",
      validation: {
        ...validation.report,
        blockers: validation.blockers,
      },
    });
    await this.appendAudit("CATALOG_IMPORT_VALIDATED", actor.id, batch.id);
    return { ...batch, reused: false };
  }

  async publishBatch(actor: SessionUser, batchId: string) {
    this.accessPolicy.assertCanManageCatalog(actor);
    const batch = await this.catalogRepository.findImportBatchById(batchId);
    if (!batch) {
      throw new NotFoundException("主材库导入批次不存在");
    }
    if (batch.status === "FAILED") {
      throw new ConflictException("校验存在阻断错误，不能发布");
    }
    if (batch.status === "PUBLISHED") {
      throw new ConflictException("该导入批次已经发布");
    }

    let catalog: PublishedHalfPackageCatalog;
    try {
      catalog = await this.catalogRepository.publishImportBatch(
        batch.id,
        actor.id,
      );
    } catch (error) {
      if (error instanceof CatalogBatchStateError) {
        throw new ConflictException("该导入批次已无法发布");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "CATALOG_VERSION_PUBLISHED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: catalog.id,
      targetType: "HALF_PACKAGE_TEMPLATE_VERSION",
    });
    return catalog;
  }

  async getPublishedCatalog(actor: SessionUser): Promise<PublishedCatalogView> {
    this.accessPolicy.assertCanReadCatalog(actor);
    const catalog = await this.catalogRepository.getPublishedCatalog();
    if (!catalog) {
      throw new NotFoundException("当前没有已发布的半包工程项版本");
    }
    if (actor.role === "ADMIN" || actor.role === "OWNER") {
      return catalog;
    }
    return {
      ...catalog,
      items: catalog.items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantityFormula: item.quantityFormula,
        rawQuantity: item.rawQuantity,
        remarks: item.remarks,
        saleUnitPrice: item.saleUnitPrice,
        sectionName: item.sectionName,
        sortOrder: item.sortOrder,
        sourceRow: item.sourceRow,
        unit: item.unit,
      })),
    };
  }

  private async appendAudit(
    action: "CATALOG_IMPORT_REUSED" | "CATALOG_IMPORT_VALIDATED",
    actorUserId: string,
    targetId: string,
  ): Promise<void> {
    await this.auditRepository.append({
      action,
      actorUserId,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId,
      targetType: "CATALOG_IMPORT_BATCH",
    });
  }
}
