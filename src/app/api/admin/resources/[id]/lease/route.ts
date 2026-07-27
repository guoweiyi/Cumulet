import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ leaseDurationDays: z.number().int().min(1).max(3650) });

/**
 * @swagger
 * /api/admin/resources/{id}/lease:
 *   patch:
 *     tags: [Resources]
 *     summary: Renew a provisioned resource lease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Lease renewed }
 *       400: { description: Resource cannot be renewed }
 *       404: { description: Resource not found }
 */

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_lease");
  const resource = await prisma.provisionedResource.findUnique({ where: { id } });
  if (!resource) throw notFound();
  if (["DELETED", "PENDING_DELETION"].includes(resource.status)) throw badRequest("resource_not_renewable");
  const leaseStartTime = new Date();
  const expiresAt = new Date(leaseStartTime.getTime() + parsed.data.leaseDurationDays * 24 * 60 * 60 * 1000);
  const updated = await prisma.provisionedResource.update({
    where: { id },
    data: {
      leaseStartTime,
      leaseDurationDays: parsed.data.leaseDurationDays,
      expiresAt,
      warningSentAt: null,
      expiredAt: null,
      deletionDueAt: null,
      status: resource.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
    },
  });
  await audit({
    actorId: actor.id,
    action: "resource.lease.renew",
    targetType: "ProvisionedResource",
    targetId: id,
    metadata: { previousExpiresAt: resource.expiresAt.toISOString(), expiresAt: updated.expiresAt.toISOString() },
  });
  return json({ resource: updated });
});
