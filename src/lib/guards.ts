import { cache } from "react";
import type { Role } from "@prisma/client";
import { auth, ADMIN_ROLES } from "@/auth";
import { prisma } from "./prisma";
import { forbidden, notFound, unauthorized } from "./api";
import { isUserManageableResource } from "./resource-access";

export type CurrentUser = {
  id: string;
  email: string;
  nickname: string | null;
  realName: string | null;
  role: Role;
  preferredLocale: string;
};

/**
 * Authoritative identity for the request: session cookie → fresh DB row.
 * Role/RBAC decisions are always made against the DB, never the JWT alone.
 * Cached per request.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return null;
  return prisma.user.findUnique({
    where: { id: uid },
    select: {
      id: true,
      email: true,
      nickname: true,
      realName: true,
      role: true,
      preferredLocale: true,
    },
  });
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  return user;
}

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Any admin-portal access (AUDITOR is read-only — use requireAdminWrite for mutations). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdminRole(user.role)) throw forbidden();
  return user;
}

/** Mutating admin operations: ADMIN or SUPER_ADMIN only (AUDITOR rejected). */
export async function requireAdminWrite(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") throw forbidden();
  return user;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") throw forbidden();
  return user;
}

/** Fully-onboarded end user (realName set). */
export async function requireOnboardedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.realName === null) throw forbidden();
  return user;
}

/**
 * Load a resource binding the caller may act on. USERs get 404 (not 403) on
 * other tenants' bindings so ids cannot be probed. Admin-capable roles may
 * read any binding; `write` additionally demands ADMIN/SUPER_ADMIN.
 */
export async function requireBindingAccess(bindingId: string, opts?: { write?: boolean }) {
  const user = await requireUser();
  if (opts?.write && user.role === "AUDITOR") throw forbidden();
  const binding = await prisma.resourceBinding.findUnique({
    where: { id: bindingId },
    include: {
      ticket: { select: { id: true, userId: true, status: true } },
      pveNode: true,
      resource: true,
    },
  });
  if (!binding) throw notFound();
  const owner = binding.ticket.userId === user.id;
  if (!owner) {
    if (!isAdminRole(user.role)) throw notFound();
  } else if (
    !isAdminRole(user.role) &&
    !isUserManageableResource(binding.ticket.status, binding.resource.status)
  ) {
    // Closed/expired/deleted resources remain visible in ticket history only.
    throw notFound();
  }
  return { user, binding, owner };
}

/** Ticket access with the same 404-on-foreign-record semantics. */
export async function requireTicketAccess(ticketId: string, opts?: { write?: boolean }) {
  const user = await requireUser();
  if (opts?.write && user.role === "AUDITOR") throw forbidden();
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { sourceInspection: { select: { id: true } } },
  });
  if (!ticket) throw notFound();
  if (ticket.sourceInspection && !isAdminRole(user.role)) throw notFound();
  const owner = ticket.userId === user.id;
  if (!owner) {
    if (!isAdminRole(user.role)) throw notFound();
  }
  return { user, ticket, owner };
}
