import { NextRequest } from "next/server";
import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { pveClient } from "@/lib/pve";
import { mapPveError } from "@/lib/vm";

/**
 * Effective-rules viewer: the VM's own rules with attached security groups
 * expanded inline (?bindingId=...).
 */
export const GET = api(async (req: NextRequest) => {
  const user = await requireAdmin();
  const bindingId = req.nextUrl.searchParams.get("bindingId");
  if (!bindingId) throw badRequest();
  const binding = await prisma.resourceBinding.findUnique({
    where: { id: bindingId },
    include: { pveNode: true },
  });
  if (!binding) throw notFound();

  const client = pveClient(binding.pveNode, user.id);
  try {
    const [rules, options] = await Promise.all([
      client.listVmRules(binding.vmid),
      client.getVmFirewallOptions(binding.vmid).catch(() => ({ enable: 0 })),
    ]);
    const expanded = await Promise.all(
      rules.map(async (r) => ({
        ...r,
        groupRules: r.type === "group" ? await client.listGroupRules(r.action).catch(() => []) : undefined,
      })),
    );
    return json({ enabled: options.enable === 1, vmid: binding.vmid, rules: expanded });
  } catch (err) {
    mapPveError(err);
  }
});
