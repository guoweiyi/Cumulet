import { NextRequest } from "next/server";
import { api, badRequest, json, notFound, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { addSystemMessage, assertTransition } from "@/lib/tickets";
import { emailTicketStatus } from "@/lib/emails";
import { pveClient } from "@/lib/pve";
import { jumpServerClient } from "@/lib/jumpserver";
import { emitTicketStatusChanged } from "@/lib/webhooks";
import { removeExternalAccess } from "@/lib/networking";

type Ctx = { params: Promise<{ id: string }> };

/**
 * De-provision: revoke JumpServer permission (+ optionally asset), detach the
 * PVE security group, and close the ticket. Best-effort external cleanup —
 * failures are logged but never block closing.
 */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      user: true,
      binding: { include: { pveNode: true } },
      sourceInspection: { select: { id: true } },
    },
  });
  if (!ticket) throw notFound();
  if (ticket.sourceInspection) throw badRequest("system_alert_workflow");
  assertTransition(ticket.status, "CLOSED");

  const body = await req.json().catch(() => ({}));
  const removeAsset = body.removeAsset === true;
  const binding = ticket.binding;
  const cleanup: Record<string, string> = {};

  if (binding) {
    const applyingChange = await prisma.resourceResizeRequest.findFirst({
      where: { resource: { ticketId: id }, status: "APPLYING" },
      select: { id: true },
    });
    if (applyingChange) throw badRequest("resource_change_applying");

    // Revoke portal management immediately, even if an external cleanup must be retried.
    await prisma.$transaction([
      prisma.provisionedResource.updateMany({
        where: { ticketId: id, status: { notIn: ["DELETED", "PENDING_DELETION"] } },
        data: { status: "SUSPENDED" },
      }),
      prisma.resourceResizeRequest.updateMany({
        where: { resource: { ticketId: id }, status: "PENDING" },
        data: {
          status: "REJECTED",
          decidedById: user.id,
          decidedAt: new Date(),
          decisionReason: "Resource deprovisioned",
        },
      }),
    ]);

    try {
      const mappings = await prisma.externalAccessMapping.findMany({
        where: { resource: { ticketId: id } },
        select: { id: true },
      });
      for (const mapping of mappings) await removeExternalAccess(mapping.id, user.id);
    } catch (err) {
      cleanup.externalAccess = err instanceof Error ? err.message : "failed";
    }
    // Permission revocation is security-critical. Persist each successful
    // cleanup immediately so retries are idempotent.
    if (binding.jsPermissionId || (removeAsset && binding.jsAssetId)) {
      try {
        const js = await jumpServerClient(user.id);
        if (binding.jsPermissionId) {
          await js.deleteAssetPermission(binding.jsPermissionId);
          await prisma.resourceBinding.update({
            where: { id: binding.id },
            data: { jsPermissionId: null },
          });
        }
        if (removeAsset && binding.jsAssetId) {
          await js.deleteHost(binding.jsAssetId);
          await prisma.resourceBinding.update({
            where: { id: binding.id },
            data: { jsAssetId: null },
          });
        }
      } catch (err) {
        cleanup.jumpserverPermission = err instanceof Error ? err.message : "failed";
      }
    }
    // Detach PVE security group
    try {
      const pve = pveClient(binding.pveNode, user.id);
      if (binding.pveSecurityGroup) {
        const rules = await pve.listVmRules(binding.vmid);
        const rule = rules.find((r) => r.type === "group" && r.action === binding.pveSecurityGroup);
        if (rule) await pve.deleteVmRule(binding.vmid, rule.pos);
      }
    } catch (err) {
      cleanup.pve = err instanceof Error ? err.message : "failed";
    }
    if (cleanup.externalAccess || cleanup.jumpserverPermission) {
      await audit({
        actorId: user.id,
        action: "ticket.deprovision_blocked",
        targetType: "Ticket",
        targetId: id,
        metadata: { cleanup },
      });
      throw new ApiError(502, "deprovision_cleanup_failed");
    }
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data: { status: "CLOSED", closedAt: now } }),
    prisma.provisionedResource.updateMany({
      where: { ticketId: id },
      data: { status: "DELETED", deletedAt: now },
    }),
  ]);
  await addSystemMessage(id, "closed");
  await audit({
    actorId: user.id,
    action: "ticket.deprovision",
    targetType: "Ticket",
    targetId: id,
    metadata: { removeAsset, cleanup },
  });
  void emailTicketStatus(ticket.user.id, ticket.user.email, id, "closed");
  await emitTicketStatusChanged({ ticketId: id, userId: ticket.userId, previousStatus: ticket.status, status: "CLOSED" });
  return json({ ok: true, cleanup });
});
