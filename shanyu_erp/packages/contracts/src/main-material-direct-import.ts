import type { MainMaterialCategoryCode } from "./index.js";

export type DirectMaterialProcessingStage = "READING" | "IMAGES" | "VALIDATING";

export interface DirectMaterialInformation {
  sheet?: string;
  categoryCode?: MainMaterialCategoryCode;
  unit?: string;
  ambiguousPriceMeaning?: "costPrice" | "salePrice";
  rows?: Record<string, { categoryCode?: MainMaterialCategoryCode; itemName?: string; unit?: string; values?: Record<string, string>; decision?: "EXCLUDE" | "SKIP" }>;
}
export interface DirectMaterialRowView {
  row: number;
  values: Record<string, string>;
  categoryCode: MainMaterialCategoryCode | null;
  itemName: string;
  suggestedName: string | null;
  suggestionReason: string;
  nameOptions: readonly string[];
  result: "NEW" | "UPDATE" | "SKIP" | "EXCLUDE" | "UNRESOLVED";
  reason: string;
  issues: readonly string[];
  warnings: readonly string[];
  pending: boolean;
  materialId: string | null;
  expectedRecordVersion: number;
  candidates: readonly { materialId: string; model: string; status: string }[];
  duplicateRows: readonly number[];
  differences: readonly { field: string; before: string; after: string }[];
  images: readonly { originalHash: string; visibleHash: string; url: string; transform: { crop: number[]; rotation: number; flipH: boolean; flipV: boolean; width: number; height: number } }[];
  oldImageUrls: readonly string[];
}
export interface DirectMaterialBatchView {
  id: string; fileName: string; fileHash: string; parserVersion: string;
  revision: number; previewHash: string;
  baseCatalogId: string | null; baseVersion: number; currentCount: number; expectedCount: number;
  sheets: readonly { name: string; rowCount: number; imageCount: number; sample: readonly Record<string, string>[] }[];
  ignoredSheets: readonly string[];
  selectedSheet: string | null;
  needsInformation: boolean; ambiguousPriceLabel: string | null;
  nameOptions: Partial<Record<MainMaterialCategoryCode, readonly string[]>>;
  information: DirectMaterialInformation;
  rows: readonly DirectMaterialRowView[];
  counts: { read: number; added: number; updated: number; skipped: number; excluded: number; unresolved: number; pending: number; warnings: number };
  canPublish: boolean;
  published: { id: string; versionNumber: number; itemCount: number; reason: string } | null;
}
