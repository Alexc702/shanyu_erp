export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface AuditRecord {
  readonly action:
    | "AUTH_LOGIN"
    | "AUTH_LOGOUT"
    | "USER_CREATED"
    | "USER_UPDATED"
    | "USER_PASSWORD_RESET"
    | "USER_DELETED"
    | "CATALOG_IMPORT_REUSED"
    | "CATALOG_IMPORT_VALIDATED"
    | "CATALOG_VERSION_PUBLISHED"
    | "PROJECT_CREATED"
    | "QUOTATION_DRAFT_CREATED"
    | "QUOTATION_COST_MARGIN_VIEWED"
    | "QUOTATION_APPROVED"
    | "QUOTATION_EXPORTED"
    | "QUOTATION_GENERATED"
    | "QUOTATION_EDITING_CONTINUED"
    | "QUOTATION_ADJUSTMENT_UPDATED"
    | "QUOTATION_ADJUSTMENT_SUBMITTED"
    | "QUOTATION_ADJUSTMENT_CONFIRMED"
    | "QUOTATION_LINE_UPDATED"
    | "QUOTATION_RETURNED"
    | "QUOTATION_SPECIAL_APPROVED"
    | "QUOTATION_SUBMITTED"
    | "QUOTATION_VERSION_CLONED"
    | "QUOTATION_VERSION_COMPARED"
    | "QUOTATION_SCOPES_SYNCED"
    | "SPACE_CREATED"
    | "SPACE_UPDATED"
    | "SPACE_DELETED";
  readonly actorUserId: string | null;
  readonly afterState?: Readonly<Record<string, unknown>> | null;
  readonly beforeState?: Readonly<Record<string, unknown>> | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly occurredAt: Date;
  readonly reason?: string | null;
  readonly result: "SUCCESS" | "FAILURE";
  readonly targetId: string | null;
  readonly targetType:
    | "CATALOG_IMPORT_BATCH"
    | "HALF_PACKAGE_QUOTATION"
    | "HALF_PACKAGE_QUOTATION_LINE"
    | "HALF_PACKAGE_TEMPLATE_VERSION"
    | "PROJECT"
    | "SESSION"
    | "SPACE"
    | "USER";
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
}
