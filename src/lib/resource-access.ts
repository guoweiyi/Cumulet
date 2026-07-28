import type { ProvisionedResourceStatus, TicketStatus } from "@prisma/client";

/** Power state is deliberately absent: a stopped ACTIVE VM must remain manageable. */
export function isUserManageableResource(
  ticketStatus: TicketStatus,
  resourceStatus: ProvisionedResourceStatus,
): boolean {
  return ticketStatus === "ACTIVE" && resourceStatus === "ACTIVE";
}
