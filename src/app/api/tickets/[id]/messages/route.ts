import { NextRequest } from "next/server";
import { api, badRequest, forbidden, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isAdminRole, requireTicketAccess } from "@/lib/guards";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { emailAdminReply } from "@/lib/emails";

type Ctx = { params: Promise<{ id: string }> };

/** Post a message to the ticket timeline (owner or admin; notes admin-only). */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { user, ticket, owner } = await requireTicketAccess(id, { write: true });
  rateLimit("ticketMessage", user.id, LIMITS.ticketMessage.max, LIMITS.ticketMessage.windowMs);

  const admin = isAdminRole(user.role);
  if (["CLOSED", "REJECTED"].includes(ticket.status)) throw badRequest("ticket_closed");

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const isInternalNote = body.isInternalNote === true;
  if (!text || text.length > 5000) throw badRequest();
  if (isInternalNote && !admin) throw forbidden();

  const message = await prisma.ticketMessage.create({
    data: { ticketId: id, authorId: user.id, body: text, isInternalNote },
  });

  // Notify the requester when an admin replies publicly on someone else's ticket.
  if (admin && !owner && !isInternalNote) {
    const requester = await prisma.user.findUnique({ where: { id: ticket.userId } });
    if (requester) void emailAdminReply(requester.id, requester.email, id);
  }
  return json({ message: { id: message.id } }, 201);
});
