import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, forbidden, json, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertResizeWithinQuota } from "@/lib/quota";
import { findBootDisk, mapPveError, vmContext } from "@/lib/vm";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

const resizeSchema = z.object({
  cores: z.number().int().min(1).max(128),
  ramMb: z.number().int().min(512).max(1024 * 1024),
  diskGb: z.number().int().min(1).max(65536),
  reason: z.string().trim().max(1000).optional(),
});

/** Submit a resource change for administrator approval; this never mutates PVE. */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId, owner } = await vmContext(id, { write: true });
  if (!owner) throw forbidden();

  const parsed = resizeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_resize");
  const { cores, ramMb, diskGb, reason } = parsed.data;
  const ramGB = Math.ceil(ramMb / 1024);

  try {
    const config = await client.vmConfig(binding.vmid);
    const disk = findBootDisk(config);
    const current = {
      cpuCores: Number(config.cores ?? 1),
      ramGB: Math.max(1, Math.ceil(Number(config.memory ?? 1024) / 1024)),
      diskGB: disk?.sizeGb || 0,
    };
    if (diskGb < current.diskGB) throw new ApiError(409, "disk_shrink_forbidden");
    if (cores === current.cpuCores && ramGB === current.ramGB && diskGb === current.diskGB) {
      throw new ApiError(409, "resize_unchanged");
    }
    await assertResizeWithinQuota(binding.ticket.userId, binding.resourceId, {
      cpuCores: cores,
      ramGB,
      diskGB: diskGb,
    });

    const pending = await prisma.resourceResizeRequest.findFirst({
      where: { resourceId: binding.resourceId, status: { in: ["PENDING", "APPLYING"] } },
      select: { id: true },
    });
    if (pending) throw new ApiError(409, "resize_already_pending");

    const change = await prisma.resourceResizeRequest.create({
      data: {
        resourceId: binding.resourceId,
        requestedById: userId,
        beforeCpuCores: current.cpuCores,
        beforeRamGB: current.ramGB,
        beforeDiskGB: current.diskGB,
        requestedCpuCores: cores,
        requestedRamGB: ramGB,
        requestedDiskGB: diskGb,
        reason: reason || null,
      },
    });
    await audit({
      actorId: userId,
      action: "vm.resize.requested",
      targetType: "ResourceResizeRequest",
      targetId: change.id,
      metadata: { resourceId: binding.resourceId, before: current, after: { cores, ramGB, diskGb } },
    });
    return json({ ok: true, requestId: change.id, status: change.status }, 202);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    mapPveError(err);
  }
});
