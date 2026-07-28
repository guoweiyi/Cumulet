import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getHypervisorProvider } from "@/lib/providers";
import { mapProviderError } from "@/lib/vm";
import { assertResizeWithinQuota } from "@/lib/quota";

type Ctx = { params: Promise<{ id: string; action: string }> };

const bodySchema = z.object({ reason: z.string().trim().max(1000).optional() });

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const admin = await requireAdminWrite();
  const { id, action } = await ctx.params;
  if (action !== "approve" && action !== "reject") throw notFound();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest("invalid_decision");
  const decisionReason = parsed.data.reason || null;

  const change = await prisma.resourceResizeRequest.findUnique({
    where: { id },
    include: { resource: true },
  });
  if (!change) throw notFound();
  if (action === "approve" && change.resource.status !== "ACTIVE") {
    throw new ApiError(409, "resource_not_active");
  }

  if (action === "reject") {
    const result = await prisma.resourceResizeRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", decidedById: admin.id, decidedAt: new Date(), decisionReason },
    });
    if (result.count !== 1) throw new ApiError(409, "resize_not_pending");
    await audit({
      actorId: admin.id,
      action: "vm.resize.rejected",
      targetType: "ResourceResizeRequest",
      targetId: id,
      metadata: { reason: decisionReason },
    });
    return json({ ok: true, status: "REJECTED" });
  }

  const claimed = await prisma.resourceResizeRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPLYING", decidedById: admin.id, decidedAt: new Date(), decisionReason },
  });
  if (claimed.count !== 1) throw new ApiError(409, "resize_not_pending");

  try {
    await assertResizeWithinQuota(change.resource.ownerId, change.resourceId, {
      cpuCores: change.requestedCpuCores,
      ramGB: change.requestedRamGB,
      diskGB: change.requestedDiskGB,
    });
    const provider = await getHypervisorProvider(change.resource.providerId, admin.id);
    await provider.resize({
      providerResourceId: change.resource.providerResourceId,
      cpuCores: change.requestedCpuCores,
      ramGB: change.requestedRamGB,
      diskGB: change.requestedDiskGB,
    });
    await prisma.$transaction([
      prisma.provisionedResource.update({
        where: { id: change.resourceId },
        data: {
          cpuCores: change.requestedCpuCores,
          ramGB: change.requestedRamGB,
          diskGB: change.requestedDiskGB,
        },
      }),
      prisma.resourceResizeRequest.update({
        where: { id },
        data: { status: "APPLIED", appliedAt: new Date(), errorMessage: null },
      }),
    ]);
    await audit({
      actorId: admin.id,
      action: "vm.resize.approved",
      targetType: "ResourceResizeRequest",
      targetId: id,
      metadata: {
        resourceId: change.resourceId,
        before: {
          cpuCores: change.beforeCpuCores,
          ramGB: change.beforeRamGB,
          diskGB: change.beforeDiskGB,
        },
        after: {
          cpuCores: change.requestedCpuCores,
          ramGB: change.requestedRamGB,
          diskGB: change.requestedDiskGB,
        },
      },
    });
    return json({ ok: true, status: "APPLIED" });
  } catch (error) {
    await prisma.resourceResizeRequest.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "provider_operation_failed",
      },
    });
    mapProviderError(error);
  }
});
