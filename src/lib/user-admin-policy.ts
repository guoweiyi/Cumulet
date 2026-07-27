import type { Role } from "@prisma/client";

export function canManageUser(actorRole: Role, targetRole: Role): boolean {
  return actorRole === "SUPER_ADMIN" || (actorRole === "ADMIN" && targetRole === "USER");
}

export function canCreateRole(actorRole: Role, newRole: Role): boolean {
  return actorRole === "SUPER_ADMIN" || (actorRole === "ADMIN" && newRole === "USER");
}

export function canGrantRoles(actorRole: Role): boolean {
  return actorRole === "SUPER_ADMIN";
}
