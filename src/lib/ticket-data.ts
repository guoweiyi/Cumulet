import { prisma } from "./prisma";
import type { FormDefinition } from "./form-engine";
import type { I18nText } from "@/i18n/config";
import type { ProvisioningStepStatus, ProvisioningStepType, TicketStatus } from "@prisma/client";

export type TicketDetailData = {
  id: string;
  status: TicketStatus;
  createdAt: string;
  values: Record<string, unknown>;
  formName: I18nText;
  formVersion: number;
  /** The exact form-version definition the ticket was submitted against. */
  definition: FormDefinition;
  isSystemAlert: boolean;
  requester?: { email: string; nickname: string | null; realName: string | null };
  messages: {
    id: string;
    body: string;
    isSystem: boolean;
    isInternalNote: boolean;
    createdAt: string;
    author: { name: string; isAdmin: boolean } | null;
  }[];
  binding: {
    id: string;
    vmid: number;
    internalIp: string;
    nodeName: string;
    steps: {
      step: ProvisioningStepType;
      status: ProvisioningStepStatus;
      errorMessage: string | null;
      startedAt: string | null;
      finishedAt: string | null;
    }[];
  } | null;
};

/**
 * Assemble the ticket detail payload. `forAdmin` controls whether internal
 * notes and requester identity are included. Caller MUST have verified access.
 */
export async function getTicketDetail(ticketId: string, forAdmin: boolean): Promise<TicketDetailData | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { email: true, nickname: true, realName: true, role: true } },
      formSchema: { select: { definition: true, version: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        where: forAdmin ? {} : { isInternalNote: false },
        include: { author: { select: { nickname: true, email: true, role: true } } },
      },
      binding: {
        include: {
          pveNode: { select: { name: true } },
          steps: { orderBy: { createdAt: "asc" } },
        },
      },
      sourceInspection: { select: { id: true } },
    },
  });
  if (!ticket) return null;

  const definition = ticket.formSchema.definition as unknown as FormDefinition;

  return {
    id: ticket.id,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    values: ticket.values as Record<string, unknown>,
    formName: definition.meta?.name ?? { zh: "" },
    formVersion: ticket.formSchema.version,
    definition,
    isSystemAlert: ticket.sourceInspection !== null,
    requester: forAdmin
      ? { email: ticket.user.email, nickname: ticket.user.nickname, realName: ticket.user.realName }
      : undefined,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      body: m.body,
      isSystem: m.isSystem,
      isInternalNote: m.isInternalNote,
      createdAt: m.createdAt.toISOString(),
      author: m.author
        ? { name: m.author.nickname ?? m.author.email, isAdmin: m.author.role !== "USER" }
        : null,
    })),
    binding: ticket.binding
      ? {
          id: ticket.binding.id,
          vmid: ticket.binding.vmid,
          internalIp: ticket.binding.internalIp,
          nodeName: ticket.binding.pveNode.name,
          steps: ticket.binding.steps.map((s) => ({
            step: s.step,
            status: s.status,
            errorMessage: s.errorMessage,
            startedAt: s.startedAt?.toISOString() ?? null,
            finishedAt: s.finishedAt?.toISOString() ?? null,
          })),
        }
      : null,
  };
}
