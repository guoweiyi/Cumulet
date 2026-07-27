import { api, json } from "@/lib/api";
import { findBootDisk, mapPveError, vmContext } from "@/lib/vm";
import { getUserQuota } from "@/lib/quota";

type Ctx = { params: Promise<{ id: string }> };

/** Live VM status + configuration + owner quota (polled ~5s by the panel). */
export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client } = await vmContext(id);
  try {
    const [status, config, fwOptions] = await Promise.all([
      client.vmStatus(binding.vmid),
      client.vmConfig(binding.vmid),
      client.getVmFirewallOptions(binding.vmid).catch(() => ({ enable: 0 })),
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
      firewallEnabled: fwOptions.enable === 1,
      quota,
    });
  } catch (err) {
    mapPveError(err);
  }
});
