import { api, json, notFound } from "@/lib/api";
import { isAdminRole, requireTicketAccess } from "@/lib/guards";
import { getTicketDetail } from "@/lib/ticket-data";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { user } = await requireTicketAccess(id);
  // Internal notes/requester identity only for admin-capable roles — an owner
  // who is a plain USER never sees them.
  const detail = await getTicketDetail(id, isAdminRole(user.role));
  if (!detail) throw notFound();
  return json({ ticket: detail });
});
