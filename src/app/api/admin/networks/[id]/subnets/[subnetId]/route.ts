import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string; subnetId: string }> };

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id, subnetId } = await ctx.params;
  const subnet = await prisma.subnet.findFirst({
    where: { id: subnetId, networkId: id },
    include: { _count: { select: { attachments: true } } },
  });
  if (!subnet) throw notFound();
  if (subnet._count.attachments) throw badRequest("subnet_in_use");
  await prisma.subnet.delete({ where: { id: subnet.id } });
  await audit({
    actorId: actor.id,
    action: "subnet.delete",
    targetType: "Subnet",
    targetId: subnet.id,
    metadata: { networkId: id },
  });
  return json({ ok: true });
});
