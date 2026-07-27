import { api, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { addSystemMessage, assertTransition } from "@/lib/tickets";
import { emailTicketStatus } from "@/lib/emails";
import { emitTicketStatusChanged } from "@/lib/webhooks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { user: true, sourceInspection: { select: { id: true } } },
  });
  if (!ticket) throw notFound();
  assertTransition(ticket.status, "CLOSED");

  await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } }),
    prisma.provisionedResource.updateMany({
      where: { ticketId: id, status: { notIn: ["DELETED", "PENDING_DELETION"] } },
      data: { status: "SUSPENDED" },
    }),
  ]);
  await addSystemMessage(id, "closed");
  await audit({ actorId: user.id, action: "ticket.close", targetType: "Ticket", targetId: id });
  if (!ticket.sourceInspection) void emailTicketStatus(ticket.user.id, ticket.user.email, id, "closed");
  await emitTicketStatusChanged({ ticketId: id, userId: ticket.userId, previousStatus: ticket.status, status: "CLOSED" });
  return json({ ok: true });
});
