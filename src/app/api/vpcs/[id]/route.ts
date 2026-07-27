import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireOnboardedUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireOnboardedUser();
  const { id } = await ctx.params;
  const vpc = await prisma.network.findFirst({
    where: { id, tenant: { memberships: { some: { userId: user.id, role: "MANAGER" } } } },
    include: { subnets: { include: { _count: { select: { attachments: true } } } } },
  });
  if (!vpc) throw notFound();
  if (vpc.subnets.some((subnet) => subnet._count.attachments > 0)) throw badRequest("vpc_in_use");
  await prisma.network.delete({ where: { id } });
  await audit({ actorId: user.id, action: "vpc.delete", targetType: "Network", targetId: id });
  return json({ ok: true });
});
