import type { SessionUser, UserRole } from "@shanyu/contracts";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";

describe("AccessPolicy", () => {
  const policy = new AccessPolicy();

  it("allows only the owner to manage users", () => {
    expect(() => policy.assertCanManageUsers(user("OWNER"))).not.toThrow();

    for (const role of [
      "LEAD_DESIGNER",
      "WOODWORK_DESIGNER",
      "PROJECT_MANAGER",
      "FINANCE",
    ] satisfies UserRole[]) {
      expect(() => policy.assertCanManageUsers(user(role))).toThrow(
        ForbiddenException,
      );
    }
  });

  it("allows only the owner to view sensitive cost and margin data", () => {
    expect(() => policy.assertCanViewSensitivePricing(user("OWNER"))).not.toThrow();
    expect(() =>
      policy.assertCanViewSensitivePricing(user("LEAD_DESIGNER")),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertCanViewSensitivePricing(user("WOODWORK_DESIGNER")),
    ).toThrow(ForbiddenException);
  });

  it("limits project creation and access to the owner or assigned lead", () => {
    const owner = user("OWNER");
    const lead = user("LEAD_DESIGNER");
    const woodwork = user("WOODWORK_DESIGNER");

    expect(() => policy.assertCanCreateProject(owner, lead.id)).not.toThrow();
    expect(() => policy.assertCanCreateProject(lead, lead.id)).not.toThrow();
    expect(() => policy.assertCanCreateProject(lead, "other-lead")).toThrow(
      ForbiddenException,
    );
    expect(() => policy.assertCanCreateProject(woodwork, lead.id)).toThrow(
      ForbiddenException,
    );

    expect(() => policy.assertCanAccessProject(owner, lead.id)).not.toThrow();
    expect(() => policy.assertCanAccessProject(lead, lead.id)).not.toThrow();
    expect(() => policy.assertCanAccessProject(woodwork, lead.id)).toThrow(
      NotFoundException,
    );
    expect(() =>
      policy.assertCanAccessProject({ ...woodwork, id: lead.id }, lead.id),
    ).toThrow(NotFoundException);
  });
});

function user(role: UserRole): SessionUser {
  return {
    id: `${role.toLowerCase()}-id`,
    account: role.toLowerCase(),
    displayName: role,
    phone: null,
    role,
  };
}
