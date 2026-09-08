/** Transport contract returned by the API liveness endpoint. */
export interface HealthResponse {
  readonly status: "ok";
}

export type UserRole =
  | "ADMIN"
  | "OWNER"
  | "LEAD_DESIGNER"
  | "WOODWORK_DESIGNER"
  | "PROJECT_MANAGER"
  | "FINANCE";

export interface SessionUser {
  readonly id: string;
  readonly account: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly role: UserRole;
}

export interface LoginRequest {
  readonly identifier: string;
  readonly password: string;
  readonly rememberMe: boolean;
}

export interface LoginResponse {
  readonly user: SessionUser;
}

export type UserStatus = "ACTIVE" | "DISABLED";

export interface UserSummary extends SessionUser {
  readonly status: UserStatus;
}

export interface CreateUserRequest {
  readonly account: string;
  readonly displayName: string;
  readonly password: string;
  readonly phone: string | null;
  readonly role: UserRole;
}

export interface UpdateUserRequest {
  readonly account: string;
  readonly displayName: string;
  readonly role: UserRole;
}

export interface ResetUserPasswordRequest {
  readonly password: string;
}

export type SpaceType =
  | "LIVING_DINING"
  | "BEDROOM"
  | "CLOSET"
  | "KITCHEN"
  | "BATHROOM"
  | "BALCONY";

export interface ProjectSpace {
  readonly area: string;
  readonly displayName: string;
  readonly height: string;
  readonly id: string;
  readonly includesBalcony: boolean;
  readonly perimeter: string;
  readonly sortOrder: number;
  readonly type: SpaceType;
}

export interface SpaceInput {
  readonly area: string;
  readonly displayName: string;
  readonly height: string;
  readonly includesBalcony: boolean;
  readonly perimeter: string;
  readonly type: SpaceType;
}

export interface ProjectSummary {
  readonly createdAt: string;
  readonly customerName: string;
  readonly id: string;
  readonly leadDesigner: SessionUser;
  readonly outerFrameArea: string;
  readonly projectAddress: string;
  readonly quotationAmount: string | null;
  readonly quotationId: string | null;
  readonly quotationStatus: HalfPackageQuotationStatus | null;
  readonly quotationVersion: number | null;
  readonly updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  readonly spaces: ProjectSpace[];
}

export interface CreateProjectRequest {
  readonly customerName: string;
  readonly leadDesignerId: string;
  readonly outerFrameArea: string;
  readonly projectAddress: string;
  readonly spaces: SpaceInput[];
}

export interface AddSpaceRequest extends SpaceInput {
  readonly confirmStandaloneBalcony: boolean;
}

export type UpdateSpaceRequest = SpaceInput;

export type HalfPackageSectionCode =
  | "WALL"
  | "LIVING_DINING"
  | "BEDROOM"
  | "BALCONY"
  | "KITCHEN_BATHROOM"
  | "PAINT"
  | "ELECTRICAL"
  | "OTHER";

export type CatalogImportStatus = "FAILED" | "VALIDATED" | "PUBLISHED";

export interface CatalogValidationReport {
  readonly blockerCount: number;
  readonly blockers: readonly string[];
  readonly costPriceCount: number;
  readonly formulaCount: number;
  readonly itemCount: number;
  readonly salePriceCount: number;
  readonly sectionCount: number;
  readonly warningSourceRows: readonly number[];
}

export interface CatalogImportBatchSummary {
  readonly createdAt: string;
  readonly fileName: string;
  readonly id: string;
  readonly publishedVersionId: string | null;
  readonly reused: boolean;
  readonly status: CatalogImportStatus;
  readonly validation: CatalogValidationReport;
}

export interface HalfPackageCatalogSection {
  readonly code: HalfPackageSectionCode;
  readonly id: string;
  readonly itemCount: number;
  readonly name: string;
  readonly sortOrder: number;
}

export interface HalfPackageCatalogItem {
  readonly costUnitPrice?: string;
  readonly id: string;
  readonly itemName: string;
  readonly quantityFormula: string | null;
  readonly rawQuantity: string | null;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionName: string;
  readonly sortOrder: number;
  readonly sourceRow: number;
  readonly unit: string;
}

export interface PublishedHalfPackageCatalogView {
  readonly id: string;
  readonly items: readonly HalfPackageCatalogItem[];
  readonly publishedAt: string;
  readonly sections: readonly HalfPackageCatalogSection[];
  readonly versionNumber: number;
}

export interface CatalogImportResponse {
  readonly batch: CatalogImportBatchSummary;
}

export interface PublishedHalfPackageCatalogResponse {
  readonly catalog: PublishedHalfPackageCatalogView;
}

export type HalfPackageQuantitySource =
  | "MANUAL"
  | "PROJECT_OUTER_FRAME_AREA"
  | "SPACE_AREA"
  | "SPACE_PERIMETER_HEIGHT"
  | "LINE_REFERENCE";

export interface HalfPackageQuotationLine {
  readonly amount: string | null;
  readonly id: string;
  readonly itemName: string;
  readonly quantity: string | null;
  readonly quantitySource: HalfPackageQuantitySource;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly sectionName: string;
  readonly selected: boolean;
  readonly unit: string;
}

export interface HalfPackageQuotationScope {
  readonly area: string | null;
  readonly height: string | null;
  readonly id: string;
  readonly lines: readonly HalfPackageQuotationLine[];
  readonly name: string;
  readonly perimeter: string | null;
  readonly projectSpaceId: string | null;
  readonly spaceType: SpaceType | null;
  readonly subtotal: string;
}

export interface HalfPackageQuotation {
  readonly adjustmentReason: string | null;
  readonly adjustmentStatus: HalfPackageAdjustmentStatus;
  readonly adjustedTotal: string;
  readonly directCost: string;
  readonly discountRate: string;
  readonly id: string;
  readonly isCurrent: boolean;
  readonly managementFee: string;
  readonly managementRate: string;
  readonly projectId: string;
  readonly projectAddress: string;
  readonly revision: number;
  readonly scopes: readonly HalfPackageQuotationScope[];
  readonly status: HalfPackageQuotationStatus;
  readonly submittedAt: string | null;
  readonly templateVersion: number;
  readonly total: string;
  readonly versionNumber: number;
  readonly writeOff: string;
}

export type HalfPackageQuotationStatus =
  | "DRAFT"
  | "QUOTED"
  | "RETURNED"
  | "APPROVED";

export type HalfPackageAdjustmentStatus =
  | "AWAITING_SUBMISSION"
  | "PENDING_APPROVAL"
  | "CONFIRMED";

export interface HalfPackageQuotationResponse {
  readonly quotation: HalfPackageQuotation;
}

export interface UpdateHalfPackageQuotationLineRequest {
  readonly expectedRevision: number;
  readonly quantity: string | null;
  readonly selected: boolean;
}

export interface SubmitHalfPackageQuotationRequest {
  readonly expectedRevision: number;
}

export interface UpdateHalfPackageAdjustmentRequest {
  readonly action: "SUBMIT_FOR_APPROVAL" | "CONFIRM";
  readonly discountRate: string;
  readonly expectedRevision: number;
  readonly reason: string | null;
  readonly writeOff: string;
}

export interface UpdateHalfPackageMarginBenchmarkRequest {
  readonly marginBenchmarkPercent: string;
}

export interface HalfPackageSubmissionCheck {
  readonly blockerCount: number;
  readonly blockers: readonly string[];
  readonly itemCount: number;
  readonly sectionCount: number;
  readonly selectedItemCount: number;
  readonly warningCount: number;
  readonly warnings: readonly string[];
}

export interface HalfPackageSubmissionCheckResponse {
  readonly check: HalfPackageSubmissionCheck;
}

export type HalfPackageApprovalDecision = "APPROVED" | "RETURNED";

export type HalfPackageApprovalAction =
  HalfPackageApprovalDecision;

export interface DecideHalfPackageQuotationRequest {
  readonly action: HalfPackageApprovalDecision;
  readonly reason: string | null;
}

export interface HalfPackageApprovalSummary {
  readonly customerName: string;
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly id: string;
  readonly outerFrameArea: string;
  readonly projectId: string;
  readonly projectAddress: string;
  readonly salesAmount: string;
  readonly status: HalfPackageQuotationStatus;
  readonly submittedAt: string | null;
  readonly thirdPartyPurchaseAmount: string | null;
  readonly versionNumber: number;
}

export interface HalfPackageApprovalListResponse {
  readonly quotations: readonly HalfPackageApprovalSummary[];
}

export interface HalfPackageQuotationVersionSummary {
  readonly adjustmentStatus: HalfPackageAdjustmentStatus;
  readonly decisionAction: HalfPackageApprovalAction | null;
  readonly decisionReason: string | null;
  readonly id: string;
  readonly isCurrent: boolean;
  readonly status: HalfPackageQuotationStatus;
  readonly submittedAt: string | null;
  readonly total: string;
  readonly versionNumber: number;
}

export interface HalfPackageQuotationVersionsResponse {
  readonly versions: readonly HalfPackageQuotationVersionSummary[];
}

export interface HalfPackageVersionDifference {
  readonly after: string | null;
  readonly before: string | null;
  readonly field:
    | "COST_UNIT_PRICE"
    | "DISCOUNT_RATE"
    | "QUANTITY"
    | "SALE_UNIT_PRICE"
    | "SELECTED"
    | "TOTAL"
    | "WRITE_OFF";
  readonly itemName: string;
  readonly scopeName: string;
}

export interface HalfPackageVersionCompareResponse {
  readonly differences: readonly HalfPackageVersionDifference[];
  readonly fromVersion: number;
  readonly toVersion: number;
}

export type HalfPackageExportFormat = "PDF" | "XLSX";

export interface CreateHalfPackageExportRequest {
  readonly format: HalfPackageExportFormat;
}

export interface HalfPackageExportRecord {
  readonly downloadPath: string;
  readonly fileName: string;
  readonly format: HalfPackageExportFormat;
  readonly id: string;
  readonly sha256: string;
}

export interface HalfPackageExportResponse {
  readonly export: HalfPackageExportRecord;
}

export interface AuditEventView {
  readonly action: string;
  readonly actorDisplayName: string | null;
  readonly actorUserId: string | null;
  readonly afterValue: Readonly<Record<string, unknown>> | null;
  readonly beforeValue: Readonly<Record<string, unknown>> | null;
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly result: "SUCCESS" | "FAILURE";
  readonly targetId: string | null;
  readonly targetType: string;
}

export interface AuditEventListResponse {
  readonly events: readonly AuditEventView[];
}

export interface HalfPackageCostMarginLine {
  readonly costAmount: string;
  readonly costUnitPrice: string;
  readonly grossMarginRate: string;
  readonly grossProfit: string;
  readonly id: string;
  readonly itemName: string;
  readonly quantity: string;
  readonly saleAmount: string;
  readonly saleUnitPrice: string;
  readonly unit: string;
}

export interface HalfPackageCostMarginScope {
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly id: string;
  readonly lines: readonly HalfPackageCostMarginLine[];
  readonly name: string;
  readonly salesAmount: string;
  readonly spaceType: SpaceType | null;
}

export interface HalfPackageCostMargin {
  readonly costVersion: {
    readonly id: string;
    readonly versionNumber: number;
  };
  readonly expectedCost: string;
  readonly grossMarginRate: string | null;
  readonly grossProfit: string;
  readonly id: string;
  readonly marginBenchmarkRate: string;
  readonly projectId: string;
  readonly projectAddress: string;
  readonly salesAmount: string;
  readonly scopes: readonly HalfPackageCostMarginScope[];
  readonly status: HalfPackageQuotationStatus;
  readonly versionNumber: number;
}

export interface HalfPackageCostMarginResponse {
  readonly costMargin: HalfPackageCostMargin;
}
