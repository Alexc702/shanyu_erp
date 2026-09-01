import { describe, expect, it } from "vitest";

import { hasOwnerPermissions } from "./permissions";

describe("hasOwnerPermissions", () => {
  it("treats administrators and owners as business permission equivalents", () => {
    expect(hasOwnerPermissions("ADMIN")).toBe(true);
    expect(hasOwnerPermissions("OWNER")).toBe(true);
    expect(hasOwnerPermissions("LEAD_DESIGNER")).toBe(false);
    expect(hasOwnerPermissions("WOODWORK_DESIGNER")).toBe(false);
    expect(hasOwnerPermissions("PROJECT_MANAGER")).toBe(false);
    expect(hasOwnerPermissions("FINANCE")).toBe(false);
  });
});
