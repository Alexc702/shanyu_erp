import { ForbiddenException } from "@nestjs/common";
import type { AuditEventView, SessionUser } from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type { AuditQueryRepository } from "../src/access/audit-query.repository";
import { AuditQueryService } from "../src/access/audit-query.service";

describe("AuditQueryService", () => {
  it("returns immutable audit details to the owner", async () => {
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

    await expect(service.list(owner, {})).resolves.toEqual(events);
  });

  it("denies audit access to non-owner roles", () => {
    const repository: AuditQueryRepository = { async list() { return []; } };
    const service = new AuditQueryService(new AccessPolicy(), repository);
    expect(() => service.list(lead, {})).toThrow(ForbiddenException);
  });
});

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
