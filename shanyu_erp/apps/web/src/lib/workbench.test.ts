import type { UserRole } from "@shanyu/contracts";
import { describe, expect, it } from "vitest";

import { getWorkbench } from "./workbench";

describe("getWorkbench", () => {
  it("gives the owner the user-management entry", () => {
    expect(getWorkbench("OWNER")).toMatchObject({
      canManageUsers: true,
      roleLabel: "老板",
    });
  });

  it("does not expose owner management to other roles", () => {
    const roles: UserRole[] = [
      "LEAD_DESIGNER",
      "WOODWORK_DESIGNER",
      "PROJECT_MANAGER",
      "FINANCE",
    ];

    for (const role of roles) {
      expect(getWorkbench(role).canManageUsers).toBe(false);
    }
  });

  it("labels the active design roles with the PRD terminology", () => {
    expect(getWorkbench("LEAD_DESIGNER").roleLabel).toBe("主案设计师");
    expect(getWorkbench("WOODWORK_DESIGNER").roleLabel).toBe("木作设计师");
  });

  it("describes the lead workbench with the implemented project scope", () => {
    expect(getWorkbench("LEAD_DESIGNER").description).toContain("住宅项目");
    expect(getWorkbench("LEAD_DESIGNER").description).toContain("统一空间");
  });
});
