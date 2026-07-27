import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getUserQuota } from "@/lib/quota";
import { findBootDisk, mapProviderError, vmContext } from "@/lib/vm";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

const resizeSchema = z.object({
  cores: z.number().int().min(1).max(128),
  ramMb: z.number().int().min(512).max(1024 * 1024),
  diskGb: z.number().int().min(1).max(65536),
});

/**
 * Reconfigure CPU/RAM (hotplug where possible) and grow the disk.
 * Quota-enforced server-side against the RESOURCE OWNER's quota; disk can
 * never shrink (409). Over-quota requests are rejected with guidance.
 */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, provider, userId, owner } = await vmContext(id, { write: true });

  const parsed = resizeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_resize");
  const { cores, ramMb, diskGb } = parsed.data;

  // Quota is checked against the owner's quota even when an admin resizes.
  if (owner) {
    const quota = await getUserQuota(binding.ticket.userId);
    if (cores > quota.maxCpuCores || ramMb > quota.maxRamGB * 1024 || diskGb > quota.maxDiskGB) {
      throw new ApiError(422, "over_quota");
    }
  }

  try {
    const config = await client.vmConfig(binding.vmid);
    const disk = findBootDisk(config);
    const currentCores = Number(config.cores ?? 1);
    const currentRam = Number(config.memory ?? 0);

    await provider.resize({
      providerResourceId: binding.resource.providerResourceId,
      cpuCores: cores,
      ramGB: Math.ceil(ramMb / 1024),
      diskGB: diskGb,
    });
    const rebootRequired = cores !== currentCores || ramMb !== currentRam;
    await prisma.provisionedResource.update({
      where: { id: binding.resourceId },
      data: { cpuCores: cores, ramGB: Math.ceil(ramMb / 1024), diskGB: diskGb },
    });

    await audit({
      actorId: userId,
      action: "vm.resize",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: {
        vmid: binding.vmid,
        before: { cores: currentCores, ramMb: currentRam, diskGb: disk?.sizeGb },
        after: { cores, ramMb, diskGb },
      },
    });
    return json({ ok: true, rebootRequired });
  } catch (err) {
    mapProviderError(err);
  }
});
