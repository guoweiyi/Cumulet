import { NextRequest } from "next/server";
import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";

/** Data for the Approve & Provision dialog. */
export const GET = api(async (req: NextRequest) => {
  await requireAdminWrite();
  const ticketId = req.nextUrl.searchParams.get("ticketId");
  const ticket = ticketId
    ? await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          values: true,
          user: { select: { tenantMemberships: { select: { tenantId: true } } } },
        },
      })
    : null;
  const tenantIds = ticket?.user.tenantMemberships.map((membership) => membership.tenantId) ?? [];
  const values = ticket?.values && typeof ticket.values === "object" && !Array.isArray(ticket.values)
    ? ticket.values as Record<string, unknown>
    : {};
  const resourceType = typeof values.resource_type === "string" && values.resource_type.trim()
    ? values.resource_type.trim().toLowerCase()
    : "vm";
  const [nodes, securityGroups, gateways, dnsZones, workflowAssignment] = await Promise.all([
    prisma.pveNode.findMany({
      select: { id: true, name: true, nodeName: true, verified: true },
      orderBy: { name: "asc" },
    }),
    prisma.securityGroup.findMany({
      select: { id: true, name: true, description: true, isProvisioningDefault: true },
      orderBy: { name: "asc" },
    }),
    prisma.reverseProxyGateway.findMany({
      where: {
        enabled: true,
        ...(ticket ? { OR: [{ tenantId: null }, { tenantId: { in: tenantIds } }] } : {}),
      },
      select: { id: true, name: true, tenantId: true, publicHost: true, mode: true },
      orderBy: { name: "asc" },
    }),
    prisma.dnsZone.findMany({
      where: ticket ? { tenantId: { in: tenantIds } } : undefined,
      select: { id: true, domain: true, tenantId: true, mode: true },
      orderBy: { domain: "asc" },
    }),
    prisma.resourceWorkflowBinding.findUnique({
      where: { resourceType },
      include: { workflowSchema: true },
    }),
  ]);
  const workflow = workflowAssignment
    ? parseWorkflowDefinition(workflowAssignment.workflowSchema.definition)
    : null;
  return json({
    nodes,
    securityGroups,
    gateways,
    dnsZones,
    workflow: workflow ? {
      id: workflowAssignment!.workflowSchemaId,
      version: workflowAssignment!.workflowSchema.version,
      name: workflow.meta.name,
      resourceType: workflow.meta.resourceType,
      steps: workflow.steps,
    } : null,
    defaultCiUser: "ubuntu",
    defaultLeaseDurationDays: 30,
  });
});
