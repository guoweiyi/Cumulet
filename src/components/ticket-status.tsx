import type { TicketStatus } from "@prisma/client";

/** Consistent status → badge tint mapping used across portal and admin. */
export const STATUS_BADGE: Record<TicketStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-blue-50 text-blue-700",
  REJECTED: "bg-neutral-100 text-neutral-500",
  PROVISIONING: "bg-cyan-50 text-cyan-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
  CLOSED: "bg-neutral-100 text-neutral-500",
};
