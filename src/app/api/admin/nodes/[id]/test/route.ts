import { api, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { pveClient, PveError } from "@/lib/pve";

type Ctx = { params: Promise<{ id: string }> };

/** "Test Connection": GET /api2/json/version against the stored node. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const node = await prisma.pveNode.findUnique({ where: { id } });
  if (!node) throw notFound();

  try {
    const version = await pveClient(node, user.id).version();
    await prisma.pveNode.update({
      where: { id },
      data: {
        verified: true,
        verifiedAt: new Date(),
        ...(node.providerInstanceId
          ? { providerInstance: { update: { status: "ACTIVE", verifiedAt: new Date() } } }
          : {}),
      },
    });
    return json({ ok: true, version: version.version });
  } catch (err) {
    await prisma.pveNode.update({
      where: { id },
      data: {
        verified: false,
        ...(node.providerInstanceId
          ? { providerInstance: { update: { status: "ERROR" } } }
          : {}),
      },
    });
    const message = err instanceof PveError ? err.message : "Connection failed";
    return json({ ok: false, message }, 502);
  }
});
