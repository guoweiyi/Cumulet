import { requireAdmin } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { FirewallCenter } from "@/components/admin/firewall-center";

export default async function SecurityGroupsPage() {
  const user = await requireAdmin();
  const canWrite = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const [nodes, bindings] = await Promise.all([
    prisma.pveNode.findMany({
      where: { verified: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.resourceBinding.findMany({
      select: { id: true, vmid: true, pveNode: { select: { name: true } } },
      orderBy: { vmid: "asc" },
    }),
  ]);
  return (
    <FirewallCenter
      canWrite={canWrite}
      hasNodes={nodes.length > 0}
      nodes={nodes}
      bindings={bindings.map((b) => ({ id: b.id, vmid: b.vmid, node: b.pveNode.name }))}
    />
  );
}
