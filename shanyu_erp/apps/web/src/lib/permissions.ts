import type { UserRole } from "@shanyu/contracts";

export function hasOwnerPermissions(role: UserRole): boolean {
  return role === "ADMIN" || role === "OWNER";
}
