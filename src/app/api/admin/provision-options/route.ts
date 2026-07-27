import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { getSetting } from "@/lib/settings";

/** Data for the Approve & Provision dialog. */
export const GET = api(async () => {
  await requireAdminWrite();
  const [nodes, securityGroups, subnets, gateways, dnsZones, provisioning] = await Promise.all([
    prisma.pveNode.findMany({
      select: { id: true, name: true, nodeName: true, verified: true },
      orderBy: { name: "asc" },
    }),
    prisma.securityGroup.findMany({
      select: { id: true, name: true, description: true, isProvisioningDefault: true },
      orderBy: { name: "asc" },
    }),
    prisma.subnet.findMany({
      where: { status: "ACTIVE", network: { status: "ACTIVE" } },
      select: {
        id: true,
        name: true,
        cidr: true,
        network: {
          select: { name: true, tenantId: true, tenant: { select: { name: true } } },
        },
      },
      orderBy: [{ network: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.reverseProxyGateway.findMany({
      where: { enabled: true },
      select: { id: true, name: true, tenantId: true, publicHost: true, mode: true },
      orderBy: { name: "asc" },
    }),
    prisma.dnsZone.findMany({
      select: { id: true, domain: true, tenantId: true, mode: true },
      orderBy: { domain: "asc" },
    }),
    getSetting("provisioning"),
  ]);
  void provisioning;
  return json({
    nodes,
    securityGroups,
    subnets,
    gateways,
    dnsZones,
    defaultCiUser: "ubuntu",
    defaultLeaseDurationDays: 30,
  });
});
