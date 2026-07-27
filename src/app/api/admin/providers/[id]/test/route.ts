import { api, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { getHypervisorProvider, ProviderError } from "@/lib/providers";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const instance = await prisma.providerInstance.findUnique({ where: { id }, select: { id: true, type: true } });
  if (!instance) throw notFound();
  try {
    const result = await (await getHypervisorProvider(id, actor.id, { allowInactive: true })).healthCheck();
    await prisma.providerInstance.update({ where: { id }, data: { status: "ACTIVE", verifiedAt: new Date() } });
    await audit({ actorId: actor.id, action: "provider.verify", targetType: "ProviderInstance", targetId: id, metadata: { type: instance.type, capabilities: result.capabilities } });
    return json({ ok: true, ...result });
  } catch (error) {
    await prisma.providerInstance.update({ where: { id }, data: { status: "ERROR", verifiedAt: null } });
    const message = error instanceof ProviderError ? error.message : "Provider connection failed";
    const code = error instanceof ProviderError ? error.code : "provider_connection_failed";
    return json({ ok: false, error: { code, message } }, 502);
  }
});
