import type {
  HalfPackageWorkbookItem,
  HalfPackageWorkbookSection,
  HalfPackageWorkbookValidation,
} from "./half-package-workbook";

export const CATALOG_REPOSITORY = Symbol("CATALOG_REPOSITORY");

export type CatalogImportStatus = "FAILED" | "VALIDATED" | "PUBLISHED";

export interface NewCatalogImportBatch {
  readonly createdByUserId: string;
  readonly fileHash: string;
  readonly fileName: string;
  readonly id: string;
  readonly items: readonly HalfPackageWorkbookItem[];
  readonly sections: readonly HalfPackageWorkbookSection[];
  readonly status: CatalogImportStatus;
  readonly validation: HalfPackageWorkbookValidation["report"] & {
    readonly blockers: readonly string[];
  };
}

export interface CatalogImportBatch extends NewCatalogImportBatch {
  readonly createdAt: Date;
  readonly publishedVersionId: string | null;
}

export interface PublishedHalfPackageSection
  extends HalfPackageWorkbookSection {
  readonly id: string;
}

export interface PublishedHalfPackageItem extends HalfPackageWorkbookItem {
  readonly id: string;
}

export interface PublishedHalfPackageCatalog {
  readonly id: string;
  readonly publishedAt: Date;
  readonly sections: readonly PublishedHalfPackageSection[];
  readonly items: readonly PublishedHalfPackageItem[];
  readonly versionNumber: number;
}

export interface CatalogRepository {
  findImportBatchByHash(fileHash: string): Promise<CatalogImportBatch | null>;
  createImportBatch(input: NewCatalogImportBatch): Promise<CatalogImportBatch>;
  findImportBatchById(batchId: string): Promise<CatalogImportBatch | null>;
  publishImportBatch(
    batchId: string,
    publishedByUserId: string,
  ): Promise<PublishedHalfPackageCatalog>;
  getPublishedCatalog(): Promise<PublishedHalfPackageCatalog | null>;
}

export class CatalogBatchStateError extends Error {}
