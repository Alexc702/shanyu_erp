export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface AuditRecord {
  readonly action:
    | "AUTH_LOGIN"
    | "AUTH_LOGOUT"
    | "USER_CREATED"
    | "CATALOG_IMPORT_REUSED"
    | "CATALOG_IMPORT_VALIDATED"
    | "CATALOG_VERSION_PUBLISHED"
    | "PROJECT_CREATED"
    | "SPACE_CREATED"
    | "SPACE_UPDATED"
    | "SPACE_DELETED";
  readonly actorUserId: string | null;
  readonly occurredAt: Date;
  readonly result: "SUCCESS" | "FAILURE";
  readonly targetId: string | null;
  readonly targetType:
    | "CATALOG_IMPORT_BATCH"
    | "HALF_PACKAGE_TEMPLATE_VERSION"
    | "PROJECT"
    | "SESSION"
    | "SPACE"
    | "USER";
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
}
