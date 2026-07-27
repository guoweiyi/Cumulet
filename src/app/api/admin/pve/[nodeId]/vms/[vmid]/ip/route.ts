import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { pveClient } from "@/lib/pve";
import { mapPveError } from "@/lib/vm";

type Ctx = { params: Promise<{ nodeId: string; vmid: string }> };

/** Read an internal IP from the VM's ipconfig0 (Approve dialog helper). */
export const GET = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { nodeId, vmid: vmidRaw } = await ctx.params;
  const vmid = Number(vmidRaw);
  if (!Number.isInteger(vmid)) throw badRequest();

  const node = await prisma.pveNode.findUnique({ where: { id: nodeId } });
  if (!node) throw notFound();

  try {
    const config = await pveClient(node, user.id).vmConfig(vmid);
    const ipconfig = typeof config.ipconfig0 === "string" ? config.ipconfig0 : "";
    const m = ipconfig.match(/ip=([0-9.]+)/);
    return json({ ip: m?.[1] ?? null, ipconfig: ipconfig || null });
  } catch (err) {
    mapPveError(err);
  }
});
