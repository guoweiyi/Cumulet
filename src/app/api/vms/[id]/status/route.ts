import { api, json } from "@/lib/api";
import { findBootDisk, mapPveError, vmContext } from "@/lib/vm";
import { getUserQuota } from "@/lib/quota";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

/** Live VM status + configuration + owner quota (polled ~5s by the panel). */
export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client } = await vmContext(id);
  try {
    const [status, config, resizeRequest] = await Promise.all([
      client.vmStatus(binding.vmid),
      client.vmConfig(binding.vmid),
      prisma.resourceResizeRequest.findFirst({
        where: { resourceId: binding.resourceId, status: { in: ["PENDING", "APPLYING"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          requestedCpuCores: true,
          requestedRamGB: true,
          requestedDiskGB: true,
          createdAt: true,
        },
      }),
    ]);
    const disk = findBootDisk(config);
    const quota = await getUserQuota(binding.ticket.userId);
    return json({
      status: {
        state: status.status,
        uptime: status.uptime,
        cpu: status.cpu,
        cpus: status.cpus,
        mem: status.mem,
        maxmem: status.maxmem,
        netin: status.netin,
        netout: status.netout,
        name: status.name ?? null,
      },
      config: {
        cores: Number(config.cores ?? status.cpus ?? 1),
        memoryMb: Number(config.memory ?? 0),
        diskGb: disk?.sizeGb ?? 0,
        diskKey: disk?.key ?? null,
        ciUser: binding.cloudInitUser,
      },
      quota,
      resizeRequest,
    });
  } catch (err) {
    mapPveError(err);
  }
});
