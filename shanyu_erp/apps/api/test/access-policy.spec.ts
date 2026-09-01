import type { SessionUser, UserRole } from "@shanyu/contracts";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";

describe("AccessPolicy", () => {
  const policy = new AccessPolicy();

  it("allows administrators and owners to manage users", () => {
    expect(() => policy.assertCanManageUsers(user("ADMIN"))).not.toThrow();
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

  it("gives administrators the same business access as owners", () => {
    expect(() =>
      policy.assertCanViewSensitivePricing(user("ADMIN")),
    ).not.toThrow();
    expect(() => policy.assertCanViewSensitivePricing(user("OWNER"))).not.toThrow();
    expect(() => policy.assertCanManageCatalog(user("ADMIN"))).not.toThrow();
    expect(() => policy.assertCanApproveQuotation(user("ADMIN"))).not.toThrow();
    expect(() =>
      policy.assertCanViewSensitivePricing(user("LEAD_DESIGNER")),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertCanViewSensitivePricing(user("WOODWORK_DESIGNER")),
    ).toThrow(ForbiddenException);
  });

  it("limits project creation and access to the owner or assigned lead", () => {
    const administrator = user("ADMIN");
    const owner = user("OWNER");
    const lead = user("LEAD_DESIGNER");
    const woodwork = user("WOODWORK_DESIGNER");

    expect(() =>
      policy.assertCanCreateProject(administrator, lead.id),
    ).not.toThrow();
    expect(() => policy.assertCanCreateProject(owner, lead.id)).not.toThrow();
    expect(() => policy.assertCanCreateProject(lead, lead.id)).not.toThrow();
    expect(() => policy.assertCanCreateProject(lead, "other-lead")).toThrow(
      ForbiddenException,
    );
    expect(() => policy.assertCanCreateProject(woodwork, lead.id)).toThrow(
      ForbiddenException,
    );

    expect(() =>
      policy.assertCanAccessProject(administrator, lead.id),
    ).not.toThrow();
    expect(() => policy.assertCanAccessProject(owner, lead.id)).not.toThrow();
    expect(() => policy.assertCanAccessProject(lead, lead.id)).not.toThrow();
    expect(() => policy.assertCanAccessProject(woodwork, lead.id)).toThrow(
      NotFoundException,
    );
    expect(() =>
      policy.assertCanAccessProject({ ...woodwork, id: lead.id }, lead.id),
    ).toThrow(NotFoundException);
  });

  it("reserves the global audit log for administrators", () => {
    expect(() => policy.assertCanReadAudit(user("ADMIN"))).not.toThrow();
    expect(() => policy.assertCanReadAudit(user("OWNER"))).toThrow(
      ForbiddenException,
    );
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
