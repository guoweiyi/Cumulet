import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json, notFound, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { addSystemMessage, assertTransition } from "@/lib/tickets";
import { emailTicketStatus } from "@/lib/emails";
import { runPipeline } from "@/lib/pipeline";
import { assertQuotaAvailable, requestedCapacity } from "@/lib/quota";
import { getDefaultQuota } from "@/lib/settings";
import { getHypervisorProvider, ProviderError } from "@/lib/providers";
import { emitTicketStatusChanged } from "@/lib/webhooks";
import { addressInCidr, ticketRequestsExternalAccess } from "@/lib/networking";
import { buildResourceName } from "@/lib/resource-naming";
import { encryptSecret } from "@/lib/crypto";
import { assignedWorkflow } from "@/lib/workflow-service";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";

type Ctx = { params: Promise<{ id: string }> };

const externalAccessSchema = z.object({
  gatewayId: z.string().min(1),
  protocol: z.enum(["TCP", "HTTP", "HTTPS"]),
  internalPort: z.number().int().min(1).max(65535),
  externalPort: z.number().int().min(1).max(65535).nullable().optional(),
  hostname: z.string().trim().min(1).max(255).nullable().optional(),
  dnsZoneId: z.string().min(1).optional(),
  ttl: z.number().int().min(30).max(86400).default(300),
}).superRefine((value, ctx) => {
  if (value.protocol === "TCP" && !value.externalPort) {
    ctx.addIssue({ code: "custom", path: ["externalPort"], message: "external_port_required" });
  }
  if (value.protocol !== "TCP" && !value.hostname) {
    ctx.addIssue({ code: "custom", path: ["hostname"], message: "hostname_required" });
  }
});

const approveSchema = z.object({
  pveNodeId: z.string().min(1),
  vmid: z.number().int().min(100).max(999_999_999),
  internalIp: z.string().min(3).max(45),
  ciUser: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
  initialPassword: z.string().min(8).max(200),
  sshKeys: z.string().max(4000).optional().default(""),
  nameserver: z.string().max(64).optional().default(""),
  ipconfig: z.string().max(128).optional().default(""),
  configureSecurityGroup: z.boolean().default(true),
  securityGroup: z.string().min(1).max(64).optional(),
  leaseDurationDays: z.number().int().min(1).max(3650).optional().default(30),
  externalAccess: externalAccessSchema.optional(),
});

/**
 * Approve & Provision: creates the ResourceBinding + step rows, transitions
 * the ticket to PROVISIONING, and runs the pipeline synchronously.
 */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { user: true, binding: true, sourceInspection: { select: { id: true } } },
  });
  if (!ticket) throw notFound();
  if (ticket.sourceInspection) throw badRequest("system_alert_workflow");
  assertTransition(ticket.status, "APPROVED"); // must be PENDING
  if (ticket.binding) throw badRequest("already_bound");

  const parsed = approveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_approve");
  const data = parsed.data;
  if (data.configureSecurityGroup && !data.securityGroup) throw badRequest("security_group_required");
  const node = await prisma.pveNode.findUnique({ where: { id: data.pveNodeId } });
  if (!node) throw badRequest("node_not_found");
  if (!node.verified) throw new ApiError(409, "node_not_verified");
  if (!node.providerInstanceId) throw new ApiError(409, "provider_not_configured");

  // Network placement is derived from the approved IP. The administrator no
  // longer chooses a user VPC manually; overlapping ranges prefer the most
  // specific prefix.
  const candidateSubnets = await prisma.subnet.findMany({
    where: {
      status: "ACTIVE",
      network: {
        status: "ACTIVE",
        tenant: { memberships: { some: { userId: ticket.userId } } },
      },
    },
    include: { network: true },
  });
  const subnet = candidateSubnets
    .filter((candidate) => addressInCidr(data.internalIp, candidate.cidr))
    .sort((left, right) => Number(right.cidr.split("/")[1] ?? 0) - Number(left.cidr.split("/")[1] ?? 0))[0] ?? null;
  if (data.externalAccess && !subnet) throw badRequest("external_access_requires_subnet");
  if (data.externalAccess && subnet) {
    const [gateway, zone] = await Promise.all([
      prisma.reverseProxyGateway.findUnique({ where: { id: data.externalAccess.gatewayId } }),
      data.externalAccess.dnsZoneId
        ? prisma.dnsZone.findUnique({ where: { id: data.externalAccess.dnsZoneId } })
        : Promise.resolve(null),
    ]);
    if (!gateway?.enabled) throw badRequest("gateway_not_available");
    if (gateway.tenantId && gateway.tenantId !== subnet.network.tenantId) {
      throw badRequest("gateway_tenant_mismatch");
    }
    if (data.externalAccess.dnsZoneId && !zone) throw badRequest("dns_zone_not_found");
    if (zone && zone.tenantId !== subnet.network.tenantId) {
      throw badRequest("dns_zone_tenant_mismatch");
    }
  }

  // Guard: a vmid can only back one binding (also enforced by DB unique).
  const clash = await prisma.resourceBinding.findFirst({
    where: { pveNodeId: node.id, vmid: data.vmid },
  });
  if (clash) throw new ApiError(409, "vmid_in_use");

  let observed;
  try {
    observed = await (await getHypervisorProvider(node.providerInstanceId, user.id)).getStatus({
      providerResourceId: String(data.vmid),
    });
  } catch (error) {
    if (error instanceof ProviderError) throw new ApiError(502, error.code, error.message);
    throw error;
  }
  const requested = requestedCapacity(ticket.values, {
    cpuCores: observed.cpuCores,
    ramGB: observed.ramGB,
    diskGB: observed.diskGB,
  });
  const capacity = {
    ...requested,
    // Existing disks cannot be shrunk. Account for the real allocation even
    // when an imported/legacy form asks for a smaller disk.
    diskGB: Math.max(requested.diskGB, observed.diskGB ?? 0),
  };
  const defaultQuota = await getDefaultQuota();
  const leaseStartTime = new Date();
  const expiresAt = new Date(
    leaseStartTime.getTime() + data.leaseDurationDays * 24 * 60 * 60 * 1000,
  );
  const values = ticket.values && typeof ticket.values === "object" && !Array.isArray(ticket.values)
    ? (ticket.values as Record<string, unknown>)
    : {};
  const resourceType = typeof values.resource_type === "string" && values.resource_type.trim()
    ? values.resource_type.trim().toLowerCase()
    : "vm";
  const assignment = await assignedWorkflow(resourceType);
  const workflowDefinition = assignment
    ? parseWorkflowDefinition(assignment.workflowSchema.definition)
    : null;
  if (!assignment || !workflowDefinition) throw badRequest("workflow_not_assigned");
  if (
    workflowDefinition.steps.includes("EXTERNAL_ACCESS") &&
    ticketRequestsExternalAccess(ticket.values) &&
    !data.externalAccess
  ) {
    throw badRequest("external_access_config_required");
  }
  const requestedName = typeof values.resource_name === "string" ? values.resource_name : `vm-${data.vmid}`;
  const displayName = buildResourceName(ticket.user, requestedName, data.vmid);

  const binding = await prisma.$transaction(async (tx) => {
    await assertQuotaAvailable(tx, ticket.userId, capacity, defaultQuota);
    await tx.ticket.update({
      where: { id },
      data: { status: "PROVISIONING", decidedById: user.id, decidedAt: new Date() },
    });
    const resource = await tx.provisionedResource.create({
      data: {
        ticketId: id,
        ownerId: ticket.userId,
        providerId: node.providerInstanceId!,
        providerResourceId: String(data.vmid),
        displayName,
        cpuCores: capacity.cpuCores,
        ramGB: capacity.ramGB,
        diskGB: capacity.diskGB,
        internalIp: data.internalIp,
        status: "PROVISIONING",
        leaseStartTime,
        leaseDurationDays: data.leaseDurationDays,
        expiresAt,
      },
    });
    const b = await tx.resourceBinding.create({
      data: {
        ticketId: id,
        pveNodeId: node.id,
        vmid: data.vmid,
        internalIp: data.internalIp,
        boundById: user.id,
        cloudInitUser: data.ciUser,
        initialPasswordEnc: encryptSecret(data.initialPassword),
        pveSecurityGroup: data.configureSecurityGroup ? data.securityGroup : null,
        resourceId: resource.id,
        workflowSchemaId: assignment.workflowSchemaId,
        provisionMeta: {
          ipconfig: data.ipconfig,
          nameserver: data.nameserver,
          sshKeys: data.sshKeys,
          configureSecurityGroup: data.configureSecurityGroup,
          ...(data.externalAccess ? { externalAccess: data.externalAccess } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    if (subnet) {
      await tx.resourceNetworkAttachment.create({
        data: {
          resourceId: resource.id,
          subnetId: subnet.id,
          ipAddress: data.internalIp,
          isPrimary: true,
        },
      });
    }
    await tx.provisioningStep.createMany({
      data: workflowDefinition.steps.map((step, position) => ({ bindingId: b.id, step, position })),
    });
    return b;
  });

  await addSystemMessage(id, "approved");
  await audit({ actorId: user.id, action: "ticket.approve", targetType: "Ticket", targetId: id, metadata: { vmid: data.vmid, node: node.name } });
  void emailTicketStatus(ticket.user.id, ticket.user.email, id, "approved");
  await emitTicketStatusChanged({
    ticketId: id,
    userId: ticket.userId,
    previousStatus: ticket.status,
    status: "APPROVED",
  });
  await emitTicketStatusChanged({
    ticketId: id,
    userId: ticket.userId,
    previousStatus: "APPROVED",
    status: "PROVISIONING",
  });

  // Synchronous pipeline; failures leave the ticket in PROVISIONING for retry.
  await runPipeline(binding.id, user.id);
  return json({ ok: true, bindingId: binding.id, resourceId: binding.resourceId });
});
