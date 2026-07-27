import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import {
  ipFromCloudInitDump,
  ipFromLxcConfig,
  ipFromVmConfig,
  PveError,
  pveClient,
  selectGuestIp,
  selectLxcIp,
  vmConfigMacs,
} from "@/lib/pve";
import { mapPveError } from "@/lib/vm";

type Ctx = { params: Promise<{ nodeId: string; vmid: string }> };

/** Read a VM IP from QEMU Guest Agent, falling back to cloud-init config. */
export const GET = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { nodeId, vmid: vmidRaw } = await ctx.params;
  const vmid = Number(vmidRaw);
  if (!Number.isInteger(vmid)) throw badRequest();

  const node = await prisma.pveNode.findUnique({ where: { id: nodeId } });
  if (!node) throw notFound();

  try {
    const client = pveClient(node, user.id);
    const qemuVms = await client.listNodeVms();
    const qemu = qemuVms.find((entry) => entry.vmid === vmid);
    const containers = qemu ? [] : await client.listNodeContainers();
    const container = containers.find((entry) => entry.vmid === vmid);
    if (!qemu && !container) throw notFound();

    if (container) {
      const config = await client.lxcConfig(vmid);
      if (container.status === "running") {
        const runtimeIp = selectLxcIp(await client.lxcNetworkInterfaces(vmid));
        if (runtimeIp) return json({ ip: runtimeIp, ipconfig: null, source: "lxc-runtime", vmType: "lxc", state: container.status });
      }
      const configuredIp = ipFromLxcConfig(config);
      if (configuredIp) return json({ ip: configuredIp, ipconfig: null, source: "lxc-config", vmType: "lxc", state: container.status });
      const stored = await prisma.resourceBinding.findUnique({ where: { pveNodeId_vmid: { pveNodeId: node.id, vmid } }, select: { internalIp: true } });
      if (stored?.internalIp) return json({ ip: stored.internalIp, ipconfig: null, source: "binding", vmType: "lxc", state: container.status, warning: "ip_from_binding" });
      return json({ ip: null, ipconfig: null, source: null, vmType: "lxc", state: container.status, warning: container.status === "stopped" ? "vm_stopped_dhcp_ip_unavailable" : "guest_ip_not_found" });
    }

    const config = await client.vmConfig(vmid);
    const ipconfigs = Object.entries(config)
      .filter(([key, value]) => /^ipconfig\d+$/.test(key) && typeof value === "string")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => String(value));
    const ipconfig = ipconfigs.join("; ");
    let agentError: PveError | null = null;
    if (qemu?.status === "running") {
      try {
        const ip = selectGuestIp(await client.vmAgentNetworkInterfaces(vmid), vmConfigMacs(config));
        if (ip) return json({ ip, ipconfig: ipconfig || null, source: "guest-agent", vmType: "qemu", state: qemu.status });
      } catch (error) {
        if (error instanceof PveError) agentError = error;
        else throw error;
      }
    }

    const configuredIp = ipFromVmConfig(config);
    if (configuredIp) return json({ ip: configuredIp, ipconfig: ipconfig || null, source: "cloud-init-config", vmType: "qemu", state: qemu?.status });

    let dumpIp: string | null = null;
    try {
      dumpIp = ipFromCloudInitDump(await client.cloudInitNetworkDump(vmid));
    } catch (error) {
      if (!(error instanceof PveError) || ![400, 500].includes(error.status)) throw error;
    }
    if (dumpIp) return json({ ip: dumpIp, ipconfig: ipconfig || null, source: "cloud-init-dump", vmType: "qemu", state: qemu?.status });

    const stored = await prisma.resourceBinding.findUnique({
      where: { pveNodeId_vmid: { pveNodeId: node.id, vmid } },
      select: { internalIp: true },
    });
    if (stored?.internalIp) return json({ ip: stored.internalIp, ipconfig: ipconfig || null, source: "binding", vmType: "qemu", state: qemu?.status, warning: "ip_from_binding" });

    const usesDhcp = ipconfigs.some((value) => /(?:^|,)(?:ip|ip6)=(?:dhcp|auto)(?:,|$)/i.test(value));
    const warning = agentError?.status === 403
      ? "guest_agent_permission_denied"
      : usesDhcp && qemu?.status !== "running"
        ? "vm_stopped_dhcp_ip_unavailable"
        : usesDhcp && agentError
          ? "guest_agent_required_for_dhcp"
          : agentError
            ? "guest_agent_unavailable"
            : "guest_ip_not_found";
    return json({
      ip: null,
      ipconfig: ipconfig || null,
      source: null,
      vmType: "qemu",
      state: qemu?.status,
      warning,
    });
  } catch (err) {
    mapPveError(err);
  }
});
