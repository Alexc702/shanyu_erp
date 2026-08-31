import type {
  HalfPackageSectionCode,
  ProjectDetail,
  SpaceType,
} from "@shanyu/contracts";

import type { QuantityRule } from "./half-package-calculator";

export const QUOTATION_REPOSITORY = Symbol("QUOTATION_REPOSITORY");

export type QuotationStatus =
  | "DRAFT"
  | "PENDING_PRICING"
  | "PENDING_SUPPLEMENT"
  | "PENDING_APPROVAL"
  | "RETURNED"
  | "APPROVED"
  | "SUPERSEDED"
  | "VOID";

export type QuotationDecisionAction =
  | "APPROVED"
  | "SPECIAL_APPROVED"
  | "RETURNED";

export interface QuotationTemplateItem {
  readonly costUnitPrice: string;
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
  readonly costAmount: string | null;
  readonly costUnitPrice: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string | null;
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
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
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
  readonly costTemplateVersionId: string;
  readonly costTemplateVersionNumber: number;
  readonly createdByUserId: string;
  readonly directCost: string;
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly id: string;
  readonly managementFee: string;
  readonly managementRate: string;
  readonly parentVersionId: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly revision: number;
  readonly ruleVersionId: string;
  readonly scopes: readonly QuotationDraftScope[];
  readonly status: QuotationStatus;
  readonly submittedAt: Date | null;
  readonly submittedByUserId: string | null;
  readonly decidedAt: Date | null;
  readonly decidedByUserId: string | null;
  readonly decisionAction: QuotationDecisionAction | null;
  readonly decisionReason: string | null;
  readonly templateVersionId: string;
  readonly templateVersionNumber: number;
  readonly total: string;
  readonly versionNumber: number;
}

export type NewQuotationDraft = QuotationDraft;

export interface QuotationRepository {
  findProject(projectId: string): Promise<ProjectDetail | null>;
  findDraft(projectId: string): Promise<QuotationDraft | null>;
  findLatest(projectId: string): Promise<QuotationDraft | null>;
  findById(quotationId: string): Promise<QuotationDraft | null>;
  listByProject(projectId: string): Promise<readonly QuotationDraft[]>;
  listPendingApproval(): Promise<readonly QuotationDraft[]>;
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
  submitDraft(
    quotationId: string,
    actorUserId: string,
    expectedRevision: number,
  ): Promise<QuotationDraft>;
  decide(
    quotationId: string,
    actorUserId: string,
    action: QuotationDecisionAction,
    reason: string | null,
  ): Promise<QuotationDraft>;
  createDraftFromVersion(
    source: QuotationDraft,
    actorUserId: string,
  ): Promise<QuotationDraft>;
  createExport(input: NewQuotationExport): Promise<QuotationExport>;
  findExport(exportId: string): Promise<QuotationExport | null>;
}

export type QuotationExportFormat = "PDF" | "XLSX";

export interface QuotationExport {
  readonly contentType: string;
  readonly createdAt: Date;
  readonly fileName: string;
  readonly format: QuotationExportFormat;
  readonly id: string;
  readonly payload: Buffer;
  readonly quotationId: string;
  readonly sha256: string;
}

export interface NewQuotationExport extends QuotationExport {
  readonly createdByUserId: string;
}

export class QuotationRevisionConflictError extends Error {}
