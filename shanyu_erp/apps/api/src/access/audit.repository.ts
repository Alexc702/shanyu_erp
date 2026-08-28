export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface AuditRecord {
  readonly action:
    | "AUTH_LOGIN"
    | "AUTH_LOGOUT"
    | "USER_CREATED"
    | "PROJECT_CREATED"
    | "SPACE_CREATED"
    | "SPACE_UPDATED"
    | "SPACE_DELETED";
  readonly actorUserId: string | null;
  readonly occurredAt: Date;
  readonly result: "SUCCESS" | "FAILURE";
  readonly targetId: string | null;
  readonly targetType: "PROJECT" | "SESSION" | "SPACE" | "USER";
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
}
