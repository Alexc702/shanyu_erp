import { ForbiddenException } from "@nestjs/common";
import type { AuditEventView, SessionUser } from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type { AuditQueryRepository } from "../src/access/audit-query.repository";
import { AuditQueryService } from "../src/access/audit-query.service";

describe("AuditQueryService", () => {
  it("returns immutable audit details to the administrator", async () => {
    const events: AuditEventView[] = [{
      action: "QUOTATION_RETURNED",
      actorDisplayName: "何总",
      actorUserId: owner.id,
      afterValue: { status: "RETURNED" },
      beforeValue: { status: "PENDING_APPROVAL" },
      id: "event-id",
      metadata: {},
      occurredAt: "2026-08-30T00:00:00.000Z",
      reason: "补充数量",
      result: "SUCCESS",
      targetId: "quotation-id",
      targetType: "HALF_PACKAGE_QUOTATION",
    }];
    const repository: AuditQueryRepository = { async list() { return events; } };
    const service = new AuditQueryService(new AccessPolicy(), repository);

    await expect(
      service.list({ ...owner, account: "admin", role: "ADMIN" }, {}),
    ).resolves.toEqual(events);
  });

  it("returns only account audit details inside user management", async () => {
    const events: AuditEventView[] = [
      auditEvent("USER_UPDATED"),
      auditEvent("QUOTATION_RETURNED"),
    ];
    const repository: AuditQueryRepository = { async list() { return events; } };
    const service = new AuditQueryService(new AccessPolicy(), repository);
    await expect(service.listUserManagement(owner)).resolves.toEqual([
      events[0],
    ]);
  });

  it("denies global audit access to owners and other non-administrator roles", () => {
    const repository: AuditQueryRepository = { async list() { return []; } };
    const service = new AuditQueryService(new AccessPolicy(), repository);
    expect(() => service.list(owner, {})).toThrow(ForbiddenException);
    expect(() => service.list(lead, {})).toThrow(ForbiddenException);
  });
});

function auditEvent(action: string): AuditEventView {
  return {
    action,
    actorDisplayName: "何总",
    actorUserId: owner.id,
    afterValue: null,
    beforeValue: null,
    id: `${action}-id`,
    metadata: {},
    occurredAt: "2026-08-30T00:00:00.000Z",
    reason: null,
    result: "SUCCESS",
    targetId: "target-id",
    targetType: "USER",
  };
}

const owner: SessionUser = {
  account: "owner",
  displayName: "何总",
  id: "11111111-1111-4111-8111-111111111111",
  phone: null,
  role: "OWNER",
};

const lead: SessionUser = {
  ...owner,
  account: "alex",
  id: "22222222-2222-4222-8222-222222222222",
  role: "LEAD_DESIGNER",
};
