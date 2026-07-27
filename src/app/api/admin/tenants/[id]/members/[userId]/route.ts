import { api, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string; userId: string }> };
export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id, userId } = await ctx.params;
  const deleted = await prisma.tenantMembership.deleteMany({ where: { tenantId: id, userId } });
  if (!deleted.count) throw notFound();
  await audit({ actorId: actor.id, action: "tenant.member.delete", targetType: "Tenant", targetId: id, metadata: { userId } });
  return json({ ok: true });
});

