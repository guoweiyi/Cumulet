import { api, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };
export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id, attachmentId } = await ctx.params;
  const deleted = await prisma.resourceNetworkAttachment.deleteMany({ where: { id: attachmentId, resourceId: id } });
  if (!deleted.count) throw notFound();
  await audit({ actorId: actor.id, action: "network.attachment.delete", targetType: "ProvisionedResource", targetId: id, metadata: { attachmentId } });
  return json({ ok: true });
});
