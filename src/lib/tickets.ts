import type { TicketStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest } from "./api";

/**
 * Server-enforced ticket state machine:
 * PENDING → APPROVED | REJECTED; APPROVED → PROVISIONING;
 * PROVISIONING → ACTIVE | FAILED; FAILED → PROVISIONING (retry);
 * any pre-ACTIVE → CLOSED; ACTIVE → CLOSED (deprovision).
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["PROVISIONING", "CLOSED"],
  PROVISIONING: ["ACTIVE", "FAILED", "CLOSED"],
  FAILED: ["PROVISIONING", "CLOSED"],
  ACTIVE: ["CLOSED"],
  REJECTED: [],
  CLOSED: [],
};

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw badRequest(`invalid_transition:${from}->${to}`);
  }
}

/**
 * System timeline events are stored as stable keys (rendered localized under
 * ticket.event.* on the client), never as free text.
 */
export type SystemEventKey = "approved" | "rejected" | "provisioned" | "provisionFailed" | "closed";

export async function addSystemMessage(ticketId: string, key: SystemEventKey): Promise<void> {
  await prisma.ticketMessage.create({
    data: { ticketId, authorId: null, body: key, isSystem: true },
  });
}
