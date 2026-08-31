import type { AuditEventView } from "@shanyu/contracts";

export const AUDIT_QUERY_REPOSITORY = Symbol("AUDIT_QUERY_REPOSITORY");

export interface AuditQuery {
  readonly action?: string;
  readonly result?: "SUCCESS" | "FAILURE";
}

export interface AuditQueryRepository {
  list(query: AuditQuery): Promise<readonly AuditEventView[]>;
}
