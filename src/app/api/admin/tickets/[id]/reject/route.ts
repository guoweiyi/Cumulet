import { NextRequest } from "next/server";
import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { addSystemMessage, assertTransition } from "@/lib/tickets";
import { emailTicketStatus } from "@/lib/emails";
import { emitTicketStatusChanged } from "@/lib/webhooks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { user: true, sourceInspection: { select: { id: true } } },
  });
  if (!ticket) throw notFound();
  if (ticket.sourceInspection) throw badRequest("system_alert_workflow");
  assertTransition(ticket.status, "REJECTED");

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
  if (!reason) throw badRequest("reason_required");

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id },
      data: { status: "REJECTED", decidedById: user.id, decidedAt: new Date() },
    }),
    prisma.ticketMessage.create({
      data: { ticketId: id, authorId: user.id, body: reason, isInternalNote: false },
    }),
  ]);
  await addSystemMessage(id, "rejected");
  await audit({ actorId: user.id, action: "ticket.reject", targetType: "Ticket", targetId: id });
  void emailTicketStatus(ticket.user.id, ticket.user.email, id, "rejected", reason);
  await emitTicketStatusChanged({ ticketId: id, userId: ticket.userId, previousStatus: ticket.status, status: "REJECTED" });
  return json({ ok: true });
});
