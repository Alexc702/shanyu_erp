import type {
  HalfPackageSectionCode,
  ProjectDetail,
  SpaceType,
} from "@shanyu/contracts";

import type { QuantityRule } from "./half-package-calculator";

export const QUOTATION_REPOSITORY = Symbol("QUOTATION_REPOSITORY");

export interface QuotationTemplateItem {
  readonly id: string;
  readonly itemName: string;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionCode: HalfPackageSectionCode;
  readonly sectionName: string;
  readonly sortOrder: number;
  readonly unit: string;
}

export interface QuotationTemplate {
  readonly id: string;
  readonly items: readonly QuotationTemplateItem[];
  readonly ruleVersionId: string;
  readonly versionNumber: number;
}

export interface QuotationDraftLine {
  readonly amount: string | null;
  readonly calculatedQuantity: string | null;
  readonly id: string;
  readonly itemName: string;
  readonly manualQuantity: string | null;
  readonly quantityRule: QuantityRule;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionCode: HalfPackageSectionCode;
  readonly sectionName: string;
  readonly selected: boolean;
  readonly sortOrder: number;
  readonly unit: string;
  readonly versionItemId: string;
}

export interface QuotationDraftScope {
  readonly area: string | null;
  readonly height: string | null;
  readonly id: string;
  readonly lines: readonly QuotationDraftLine[];
  readonly name: string;
  readonly perimeter: string | null;
  readonly projectSpaceId: string | null;
  readonly sortOrder: number;
  readonly spaceType: SpaceType | null;
  readonly subtotal: string;
}

export interface QuotationDraft {
  readonly buildingArea: string;
  readonly createdByUserId: string;
  readonly directCost: string;
  readonly id: string;
  readonly managementFee: string;
  readonly managementRate: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly revision: number;
  readonly ruleVersionId: string;
  readonly scopes: readonly QuotationDraftScope[];
  readonly status: "DRAFT";
  readonly templateVersionId: string;
  readonly templateVersionNumber: number;
  readonly total: string;
}

export type NewQuotationDraft = QuotationDraft;

export interface QuotationRepository {
  findProject(projectId: string): Promise<ProjectDetail | null>;
  findDraft(projectId: string): Promise<QuotationDraft | null>;
  findPublishedTemplate(): Promise<QuotationTemplate | null>;
  findTemplate(
    templateVersionId: string,
    ruleVersionId: string,
  ): Promise<QuotationTemplate | null>;
  createDraft(input: NewQuotationDraft): Promise<QuotationDraft>;
  addDraftScopes(
    input: QuotationDraft,
    scopes: readonly QuotationDraftScope[],
    expectedRevision: number,
  ): Promise<QuotationDraft>;
  saveDraft(
    input: QuotationDraft,
    expectedRevision: number,
  ): Promise<QuotationDraft>;
}

export class QuotationRevisionConflictError extends Error {}
