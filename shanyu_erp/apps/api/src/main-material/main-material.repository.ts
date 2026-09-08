import type {
  MainMaterialCategoryCode,
  MainMaterialDataStatus,
} from "@shanyu/contracts";

export const MAIN_MATERIAL_REPOSITORY = Symbol("MAIN_MATERIAL_REPOSITORY");

export interface MainMaterialAsset {
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly storagePath: string;
}

export interface MainMaterialItem {
  readonly assetIds: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly brand: string;
  readonly catalogVersionId: string;
  readonly categoryCode: MainMaterialCategoryCode;
  readonly categoryName: string;
  readonly colors: readonly string[];
  readonly costPrice: string | null;
  readonly id: string;
  readonly itemName: string;
  readonly materialId: string;
  readonly missingFields: string;
  readonly model: string;
  readonly priceDerivation?: string;
  readonly recordVersion: number;
  readonly remarks: string;
  readonly salePrice: string | null;
  readonly series: string;
  readonly sourceFile?: string;
  readonly sourceRow?: string;
  readonly sourceSheet?: string;
  readonly spec: string;
  readonly status: MainMaterialDataStatus;
  readonly unit: string;
}

export interface MainMaterialCatalog {
  readonly id: string;
  readonly items: readonly MainMaterialItem[];
  readonly name: string;
  readonly publishedAt: Date;
  readonly versionNumber: number;
}

export interface MainMaterialQuoteLine {
  readonly assetIds: readonly string[];
  readonly baseQuantity: string | null;
  readonly brand: string | null;
  readonly categoryCode: MainMaterialCategoryCode;
  readonly colors: readonly string[];
  readonly costAmount: string | null;
  readonly costUnitPrice: string | null;
  readonly demandName: string;
  readonly demandSpec: string;
  readonly id: string;
  readonly itemName: string | null;
  readonly itemVersionId: string | null;
  readonly lossRate: string;
  readonly materialId: string | null;
  readonly model: string | null;
  readonly origin: "AUTO_TILE" | "MANUAL";
  readonly quantity: string;
  readonly saleAmount: string | null;
  readonly saleUnitPrice: string | null;
  readonly scopeName: string;
  readonly selectedColor: string | null;
  readonly series: string | null;
  readonly spec: string | null;
  readonly unit: string | null;
}

export interface MainMaterialQuotation {
  readonly catalog: {
    readonly id: string;
    readonly name: string;
    readonly versionNumber: number;
  };
  readonly directCost: string;
  readonly expectedCost: string;
  readonly id: string;
  readonly lines: readonly MainMaterialQuoteLine[];
  readonly managementFee: string;
  readonly projectId: string;
  readonly revision: number;
  readonly status: "DRAFT" | "QUOTED" | "RETURNED" | "APPROVED";
  readonly total: string;
}

export interface NormalizedMainMaterialItem {
  readonly attributes: Readonly<Record<string, string>>;
  readonly brand: string;
  readonly categoryCode: MainMaterialCategoryCode;
  readonly categoryName: string;
  readonly colors: readonly string[];
  readonly costPrice: string | null;
  readonly itemName: string;
  readonly materialId: string;
  readonly missingFields: string;
  readonly model: string;
  readonly priceDerivation?: string;
  readonly recordVersion: number;
  readonly remarks: string;
  readonly salePrice: string | null;
  readonly series: string;
  readonly sourceFile?: string;
  readonly sourceRow?: string;
  readonly sourceSheet?: string;
  readonly spec: string;
  readonly status: MainMaterialDataStatus;
  readonly unit: string;
}

export interface MainMaterialDelta {
  readonly changeReason: string;
  readonly expectedRecordVersion: number;
  readonly materialId: string;
  readonly operation: "UPSERT" | "DEACTIVATE" | "REACTIVATE";
  readonly values: Readonly<Record<string, string | null>>;
}

export interface NewMainMaterialImportBatch {
  readonly createdByUserId: string;
  readonly fileHash: string;
  readonly fileName: string;
  readonly id: string;
  readonly mode: "FULL" | "DELTA";
  readonly payload: readonly NormalizedMainMaterialItem[] | readonly MainMaterialDelta[];
  readonly status: "FAILED" | "VALIDATED" | "PUBLISHED";
  readonly validation: Readonly<Record<string, unknown>>;
}

export interface MainMaterialImportBatch extends NewMainMaterialImportBatch {
  readonly createdAt: Date;
  readonly publishedVersionId: string | null;
}

export interface MainMaterialRepository {
  createImportBatch(input: NewMainMaterialImportBatch): Promise<MainMaterialImportBatch>;
  findAsset(assetId: string): Promise<MainMaterialAsset | null>;
  findImportBatch(batchId: string): Promise<MainMaterialImportBatch | null>;
  findImportBatchByHash(fileHash: string, mode: "FULL" | "DELTA"): Promise<MainMaterialImportBatch | null>;
  findItem(itemVersionId: string): Promise<MainMaterialItem | null>;
  getPublishedCatalog(): Promise<MainMaterialCatalog | null>;
  getQuotationById(quotationId: string): Promise<MainMaterialQuotation | null>;
  getQuotationByProject(projectId: string): Promise<MainMaterialQuotation | null>;
  initializeAndSyncDraft(projectId: string): Promise<MainMaterialQuotation | null>;
  refreshDraftCatalog(input: {
    readonly expectedRevision: number;
    readonly projectId: string;
  }): Promise<MainMaterialQuotation>;
  publishImportBatch(batchId: string, actorUserId: string): Promise<MainMaterialCatalog>;
  addManualLine(input: {
    readonly categoryCode: Exclude<MainMaterialCategoryCode, "TILE">;
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly id: string;
    readonly itemVersionId: string;
    readonly projectId: string;
    readonly quantity: string;
  }): Promise<MainMaterialQuotation>;
  removeManualLine(input: {
    readonly expectedRevision: number;
    readonly lineId: string;
    readonly projectId: string;
  }): Promise<MainMaterialQuotation>;
  selectLine(input: {
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly itemVersionId: string;
    readonly lineId: string;
    readonly projectId: string;
    readonly quantity?: string;
  }): Promise<MainMaterialQuotation>;
  validateDelta(changes: readonly MainMaterialDelta[]): Promise<{ readonly pendingItemCount: number }>;
}

export class MainMaterialRevisionConflictError extends Error {}
export class MainMaterialSelectionError extends Error {}
