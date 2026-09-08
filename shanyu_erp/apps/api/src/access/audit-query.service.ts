import { Inject, Injectable } from "@nestjs/common";
import type { AuditEventView, SessionUser } from "@shanyu/contracts";

import { AccessPolicy } from "./access.policy";
import {
  AUDIT_QUERY_REPOSITORY,
  type AuditQuery,
  type AuditQueryRepository,
} from "./audit-query.repository";

const userManagementActions = new Set([
  "USER_CREATED",
  "USER_UPDATED",
  "USER_PASSWORD_RESET",
  "USER_DELETED",
]);

const operationalAuditActions = new Set([
  "AUTH_LOGIN",
  "AUTH_LOGOUT",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_PASSWORD_RESET",
  "USER_DELETED",
  "CATALOG_IMPORT_REUSED",
  "CATALOG_IMPORT_VALIDATED",
  "CATALOG_VERSION_PUBLISHED",
  "PROJECT_CREATED",
  "SPACE_CREATED",
  "SPACE_UPDATED",
  "SPACE_DELETED",
  "QUOTATION_LINE_UPDATED",
  "QUOTATION_SCOPES_SYNCED",
  "QUOTATION_GENERATED",
  "QUOTATION_EDITING_CONTINUED",
  "QUOTATION_ADJUSTMENT_SUBMITTED",
  "QUOTATION_ADJUSTMENT_CONFIRMED",
  "QUOTATION_APPROVED",
  "QUOTATION_RETURNED",
  "QUOTATION_EXPORTED",
]);

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(AUDIT_QUERY_REPOSITORY)
    private readonly repository: AuditQueryRepository,
  ) {}

  async list(
    actor: SessionUser,
    query: AuditQuery,
  ): Promise<readonly AuditEventView[]> {
    this.accessPolicy.assertCanReadAudit(actor);
    const events = await this.repository.list(query);
    return events.filter((event) => operationalAuditActions.has(event.action));
  }

  async listUserManagement(
    actor: SessionUser,
  ): Promise<readonly AuditEventView[]> {
    this.accessPolicy.assertCanManageUsers(actor);
    const events = await this.repository.list({});
    return events.filter((event) => userManagementActions.has(event.action));
  }
}
