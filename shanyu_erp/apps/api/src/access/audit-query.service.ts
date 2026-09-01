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

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(AUDIT_QUERY_REPOSITORY)
    private readonly repository: AuditQueryRepository,
  ) {}

  list(
    actor: SessionUser,
    query: AuditQuery,
  ): Promise<readonly AuditEventView[]> {
    this.accessPolicy.assertCanReadAudit(actor);
    return this.repository.list(query);
  }

  async listUserManagement(
    actor: SessionUser,
  ): Promise<readonly AuditEventView[]> {
    this.accessPolicy.assertCanManageUsers(actor);
    const events = await this.repository.list({});
    return events.filter((event) => userManagementActions.has(event.action));
  }
}
