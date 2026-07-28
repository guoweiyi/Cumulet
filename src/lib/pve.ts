import "server-only";
import { Agent, fetch as ufetch } from "undici";
import type { PveNode } from "@prisma/client";
import { decryptSecret } from "./crypto";
import { audit } from "./audit";

/**
 * Typed Proxmox VE 9.x REST client. Server-side only — tokens never reach the
 * browser. All URLs are built from admin-stored node settings (never from
 * user input) to rule out SSRF.
 */

export class PveError extends Error {
  constructor(
    public status: number,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "PveError";
  }
}

const TIMEOUT_MS = 15_000;
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export type PowerAction = "start" | "shutdown" | "reboot" | "stop";

export type VmCurrentStatus = {
  status: "running" | "stopped" | "paused" | string;
  uptime: number;
  cpu: number; // 0..1 fraction of allotted cores
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  netin: number;
  netout: number;
  name?: string;
  qmpstatus?: string;
};

export type PveGuestExecStatus = {
  exited?: boolean | number;
  exitcode?: number;
  "out-data"?: string;
  "err-data"?: string;
};

export function guestPasswordInput(username: string, password: string): Buffer {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) {
    throw new PveError(400, "Invalid Linux guest username");
  }
  if (password.includes("\n") || password.includes("\r") || password.includes("\0")) {
    throw new PveError(400, "Invalid guest password");
  }
  return Buffer.from(`${username}:${password}\n`, "utf8");
}

export class PveClient {
  private base: string;
  private authHeader: string;
  private agentOpts: { dispatcher?: Agent };

  constructor(
    private node: Pick<PveNode, "apiUrl" | "nodeName" | "tokenId" | "tokenSecretEnc" | "tlsVerify">,
    private actorId?: string | null,
  ) {
    this.base = node.apiUrl.replace(/\/$/, "");
    this.authHeader = `PVEAPIToken=${node.tokenId}=${decryptSecret(node.tokenSecretEnc)}`;
    this.agentOpts = node.tlsVerify ? {} : { dispatcher: insecureAgent };
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = `${this.base}/api2/json${path}`;
    let res;
    try {
      res = await ufetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: body
          ? new URLSearchParams(
              Object.fromEntries(
                Object.entries(body)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, String(v)]),
              ),
            ).toString()
          : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...this.agentOpts,
      });
    } catch (err) {
      throw new PveError(0, `PVE unreachable: ${err instanceof Error ? err.message : "network error"}`, path);
    }
    const text = await res.text();
    if (!res.ok) {
      // PVE error bodies: { errors: {field: msg} } or status line message
      let detail = res.statusText;
      try {
        const parsed = JSON.parse(text);
        if (parsed.errors) detail = JSON.stringify(parsed.errors);
        else if (parsed.message) detail = parsed.message;
      } catch {
        if (text) detail = text.slice(0, 300);
      }
      const permissionHint = res.status === 403
        ? " API token permission denied; check the token ACL and privilege separation."
        : "";
      throw new PveError(res.status, `PVE ${res.status}: ${detail}${permissionHint}`, path);
    }
    if (method !== "GET") {
      await audit({
        actorId: this.actorId ?? null,
        action: `pve.${method.toLowerCase()}`,
        targetType: "PVE",
        targetId: path,
      });
    }
    try {
      return (JSON.parse(text) as { data: T }).data;
    } catch {
      return undefined as T;
    }
  }

  // --- basics ---------------------------------------------------------------

  version(): Promise<{ version: string; release: string }> {
    return this.request("GET", "/version");
  }

  listNodeVms(): Promise<Array<{ vmid: number; name?: string; status?: string }>> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu`);
  }

  listNodeContainers(): Promise<Array<{ vmid: number; name?: string; status?: string }>> {
    return this.request("GET", `/nodes/${this.node.nodeName}/lxc`);
  }

  // --- VM lifecycle ---------------------------------------------------------

  vmStatus(vmid: number): Promise<VmCurrentStatus> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/status/current`);
  }

  vmConfig(vmid: number): Promise<Record<string, string | number>> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/config`);
  }

  cloudInitNetworkDump(vmid: number): Promise<string> {
    return this.request(
      "GET",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/cloudinit/dump?type=network`,
    );
  }

  async vmAgentNetworkInterfaces(vmid: number): Promise<PveGuestInterface[]> {
    const response = await this.request<PveGuestInterface[] | { result?: PveGuestInterface[] }>(
      "GET",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/agent/network-get-interfaces`,
    );
    return Array.isArray(response) ? response : response?.result ?? [];
  }

  async guestExec(vmid: number, command: string[], input?: Buffer): Promise<number> {
    const response = await this.request<{ pid?: number } | number>(
      "POST",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/agent/exec`,
      {
        command: JSON.stringify(command),
        "input-data": input?.toString("base64"),
        "capture-output": 1,
      },
    );
    const pid = typeof response === "number" ? response : response?.pid;
    if (!Number.isInteger(pid)) {
      throw new PveError(502, "PVE guest agent returned an invalid process id");
    }
    return pid as number;
  }

  guestExecStatus(vmid: number, pid: number): Promise<PveGuestExecStatus> {
    return this.request(
      "GET",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/agent/exec-status?pid=${pid}`,
    );
  }

  /** Change an existing Linux guest account password through QEMU Guest Agent. */
  async setLinuxGuestPassword(vmid: number, username: string, password: string): Promise<void> {
    const state = await this.vmStatus(vmid);
    if (state.status !== "running") {
      throw new PveError(409, "The VM must be running to reset its OS password");
    }
    const pid = await this.guestExec(
      vmid,
      ["/usr/sbin/chpasswd"],
      guestPasswordInput(username, password),
    );
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.guestExecStatus(vmid, pid);
      if (status.exited === 1 || status.exited === true) {
        if (status.exitcode !== 0) {
          const detail = status["err-data"] || status["out-data"] || "chpasswd failed";
          throw new PveError(502, `Guest password reset failed: ${detail.slice(0, 300)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new PveError(504, "Timed out waiting for the guest password reset");
  }

  lxcConfig(vmid: number): Promise<Record<string, string | number>> {
    return this.request("GET", `/nodes/${this.node.nodeName}/lxc/${vmid}/config`);
  }

  async lxcNetworkInterfaces(vmid: number): Promise<PveLxcInterface[]> {
    const response = await this.request<PveLxcInterface[] | null>(
      "GET",
      `/nodes/${this.node.nodeName}/lxc/${vmid}/interfaces`,
    );
    return Array.isArray(response) ? response : [];
  }

  power(vmid: number, action: PowerAction): Promise<string> {
    return this.request("POST", `/nodes/${this.node.nodeName}/qemu/${vmid}/status/${action}`);
  }

  taskStatus(upid: string): Promise<{ status: "running" | "stopped"; exitstatus?: string }> {
    return this.request(
      "GET",
      `/nodes/${this.node.nodeName}/tasks/${encodeURIComponent(upid)}/status`,
    );
  }

  /** RRD metrics for charts. timeframe: hour | day | week */
  rrdData(vmid: number, timeframe: "hour" | "day" | "week"): Promise<Record<string, number>[]> {
    return this.request(
      "GET",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
    );
  }

  /** Recent host syslog lines; callers must filter by VM before further use. */
  nodeSyslog(limit = 200): Promise<{ n?: number; t?: string }[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return this.request(
      "GET",
      `/nodes/${this.node.nodeName}/syslog?start=0&limit=${safeLimit}`,
    );
  }

  // --- configuration & Cloud-Init -------------------------------------------

  setConfig(vmid: number, config: Record<string, string | number | undefined>): Promise<string> {
    return this.request("PUT", `/nodes/${this.node.nodeName}/qemu/${vmid}/config`, config);
  }

  resizeDisk(vmid: number, disk: string, sizeGb: number): Promise<string> {
    return this.request("PUT", `/nodes/${this.node.nodeName}/qemu/${vmid}/resize`, {
      disk,
      size: `${sizeGb}G`,
    });
  }

  /** Regenerate the cloud-init drive after ci* config changes (best-effort). */
  async regenerateCloudInit(vmid: number): Promise<void> {
    try {
      await this.request("PUT", `/nodes/${this.node.nodeName}/qemu/${vmid}/cloudinit`);
    } catch {
      // Older PVE regenerates on next boot; not fatal.
    }
  }

  // --- noVNC ----------------------------------------------------------------

  async vncProxy(vmid: number): Promise<{ ticket: string; port: string; upid: string }> {
    return this.request("POST", `/nodes/${this.node.nodeName}/qemu/${vmid}/vncproxy`, {
      websocket: 1,
    });
  }

  /** WebSocket URL + headers for the in-app proxy to dial. */
  vncWebsocketTarget(vmid: number, port: string, ticket: string): { url: string; headers: Record<string, string>; tlsVerify: boolean } {
    const wsBase = this.base.replace(/^http/, "ws");
    return {
      url: `${wsBase}/api2/json/nodes/${this.node.nodeName}/qemu/${vmid}/vncwebsocket?port=${encodeURIComponent(port)}&vncticket=${encodeURIComponent(ticket)}`,
      headers: { Authorization: this.authHeader },
      tlsVerify: this.node.tlsVerify,
    };
  }

  // --- cluster firewall: security groups ------------------------------------

  listGroups(): Promise<{ group: string; comment?: string }[]> {
    return this.request("GET", "/cluster/firewall/groups");
  }

  createGroup(group: string, comment?: string): Promise<void> {
    return this.request("POST", "/cluster/firewall/groups", { group, comment });
  }

  updateGroup(group: string, comment?: string): Promise<void> {
    return this.request("PUT", `/cluster/firewall/groups/${encodeURIComponent(group)}`, {
      comment,
    });
  }

  deleteGroup(group: string): Promise<void> {
    return this.request("DELETE", `/cluster/firewall/groups/${encodeURIComponent(group)}`);
  }

  listGroupRules(group: string): Promise<PveFirewallRule[]> {
    return this.request("GET", `/cluster/firewall/groups/${encodeURIComponent(group)}`);
  }

  addGroupRule(group: string, rule: PveRuleInput): Promise<void> {
    return this.request("POST", `/cluster/firewall/groups/${encodeURIComponent(group)}`, {
      ...rule,
    });
  }

  updateGroupRule(group: string, pos: number, rule: Partial<PveRuleInput>): Promise<void> {
    return this.request(
      "PUT",
      `/cluster/firewall/groups/${encodeURIComponent(group)}/${pos}`,
      rule,
    );
  }

  moveGroupRule(group: string, pos: number, moveTo: number): Promise<void> {
    return this.request(
      "PUT",
      `/cluster/firewall/groups/${encodeURIComponent(group)}/${pos}`,
      { moveto: moveTo },
    );
  }

  deleteGroupRule(group: string, pos: number): Promise<void> {
    return this.request("DELETE", `/cluster/firewall/groups/${encodeURIComponent(group)}/${pos}`);
  }

  // --- cluster firewall: IPSets & aliases ------------------------------------

  listIpsets(): Promise<{ name: string; comment?: string }[]> {
    return this.request("GET", "/cluster/firewall/ipset");
  }

  createIpset(name: string, comment?: string): Promise<void> {
    return this.request("POST", "/cluster/firewall/ipset", { name, comment });
  }

  updateIpset(name: string, comment?: string): Promise<void> {
    return this.request("PUT", `/cluster/firewall/ipset/${encodeURIComponent(name)}`, {
      comment,
    });
  }

  deleteIpset(name: string): Promise<void> {
    return this.request("DELETE", `/cluster/firewall/ipset/${encodeURIComponent(name)}`);
  }

  listIpsetEntries(name: string): Promise<{ cidr: string; comment?: string; nomatch?: number }[]> {
    return this.request("GET", `/cluster/firewall/ipset/${encodeURIComponent(name)}`);
  }

  addIpsetEntry(name: string, cidr: string, comment?: string, nomatch?: number): Promise<void> {
    return this.request("POST", `/cluster/firewall/ipset/${encodeURIComponent(name)}`, {
      cidr,
      comment,
      nomatch,
    });
  }

  deleteIpsetEntry(name: string, cidr: string): Promise<void> {
    return this.request(
      "DELETE",
      `/cluster/firewall/ipset/${encodeURIComponent(name)}/${encodeURIComponent(cidr)}`,
    );
  }

  listAliases(): Promise<{ name: string; cidr: string; comment?: string }[]> {
    return this.request("GET", "/cluster/firewall/aliases");
  }

  createAlias(name: string, cidr: string, comment?: string): Promise<void> {
    return this.request("POST", "/cluster/firewall/aliases", { name, cidr, comment });
  }

  updateAlias(name: string, cidr: string, comment?: string): Promise<void> {
    return this.request("PUT", `/cluster/firewall/aliases/${encodeURIComponent(name)}`, {
      cidr,
      comment,
    });
  }

  deleteAlias(name: string): Promise<void> {
    return this.request("DELETE", `/cluster/firewall/aliases/${encodeURIComponent(name)}`);
  }

  // --- VM firewall ----------------------------------------------------------

  listVmRules(vmid: number): Promise<PveFirewallRule[]> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/rules`);
  }

  addVmRule(vmid: number, rule: PveRuleInput): Promise<void> {
    return this.request("POST", `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/rules`, {
      ...rule,
    });
  }

  updateVmRule(vmid: number, pos: number, rule: Partial<PveRuleInput>): Promise<void> {
    return this.request(
      "PUT",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/rules/${pos}`,
      rule,
    );
  }

  deleteVmRule(vmid: number, pos: number): Promise<void> {
    return this.request(
      "DELETE",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/rules/${pos}`,
    );
  }

  getVmFirewallOptions(vmid: number): Promise<{ enable?: number }> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/options`);
  }

  setVmFirewallOptions(vmid: number, options: { enable?: number }): Promise<void> {
    return this.request(
      "PUT",
      `/nodes/${this.node.nodeName}/qemu/${vmid}/firewall/options`,
      options,
    );
  }
}

export type PveFirewallRule = {
  pos: number;
  type: "in" | "out" | "group";
  action: string; // ACCEPT | DROP | REJECT | <group name> for type=group
  enable?: number;
  proto?: string;
  dport?: string;
  sport?: string;
  source?: string;
  dest?: string;
  macro?: string;
  comment?: string;
};

export type PveGuestInterface = {
  name?: string;
  "hardware-address"?: string;
  "ip-addresses"?: Array<{
    "ip-address"?: string;
    "ip-address-type"?: "ipv4" | "ipv6" | string;
    prefix?: number;
  }>;
};

export type PveLxcInterface = {
  name?: string;
  hwaddr?: string;
  inet?: string;
  inet6?: string;
};

function ipv4Number(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4Number(ip);
  if (value === null) return false;
  const inRange = (base: number, prefix: number) =>
    (value >>> (32 - prefix)) === (base >>> (32 - prefix));
  return inRange(0x0a000000, 8) || inRange(0xac100000, 12) || inRange(0xc0a80000, 16);
}

function normalizeMac(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", ":");
}

export function vmConfigMacs(config: Record<string, string | number>): string[] {
  return Object.entries(config)
    .filter(([key, value]) => /^net\d+$/.test(key) && typeof value === "string")
    .map(([, value]) => String(value).match(/(?:^|,)(?:virtio|e1000|rtl8139|vmxnet3)=([0-9a-f:]{17})/i)?.[1] ?? "")
    .filter(Boolean)
    .map(normalizeMac);
}

/** Pick the primary guest address, preferring interfaces whose MAC is in the VM config. */
export function selectGuestIp(interfaces: PveGuestInterface[], preferredMacs: string[] = []): string | null {
  const preferred = new Set(preferredMacs.map(normalizeMac));
  const addressesOf = (entries: PveGuestInterface[]) => entries
    .flatMap((entry) => entry["ip-addresses"] ?? [])
    .map((entry) => entry["ip-address"] ?? "")
    .filter((ip) => ip && ip !== "127.0.0.1" && ip !== "::1" && !ip.startsWith("169.254.") && !ip.toLowerCase().startsWith("fe80:"));
  const choose = (addresses: string[]) =>
    addresses.find(isPrivateIpv4) ?? addresses.find((ip) => ipv4Number(ip) !== null) ?? addresses[0] ?? null;
  if (preferred.size) {
    const matched = interfaces.filter((entry) => preferred.has(normalizeMac(entry["hardware-address"] ?? "")));
    const selected = choose(addressesOf(matched));
    if (selected) return selected;
  }
  return choose(addressesOf(interfaces));
}

export function ipFromCloudInitConfig(ipconfig: string): string | null {
  const candidates = [...ipconfig.matchAll(/(?:^|,)(?:ip|ip6)=([^,/]+)(?:\/\d+)?(?=,|$)/gi)]
    .map((match) => match[1].trim())
    .filter((ip) => !["dhcp", "auto", "manual"].includes(ip.toLowerCase()));
  return candidates.find(isPrivateIpv4) ?? candidates.find((ip) => ipv4Number(ip) !== null) ?? candidates[0] ?? null;
}

export function ipFromVmConfig(config: Record<string, string | number>): string | null {
  const candidates = Object.entries(config)
    .filter(([key, value]) => /^ipconfig\d+$/.test(key) && typeof value === "string")
    .map(([, value]) => ipFromCloudInitConfig(String(value)))
    .filter((value): value is string => value !== null);
  return candidates.find(isPrivateIpv4) ?? candidates[0] ?? null;
}

export function ipFromCloudInitDump(dump: string): string | null {
  const candidates = [...dump.matchAll(/^\s+(?:address|addresses):\s*['"]?([^'"\s,\[\]]+)/gim)]
    .map((match) => match[1].replace(/\/\d+$/, ""))
    .filter((ip) => ipv4Number(ip) !== null || ip.includes(":"));
  return candidates.find(isPrivateIpv4) ?? candidates[0] ?? null;
}

export function selectLxcIp(interfaces: PveLxcInterface[]): string | null {
  const candidates = interfaces.flatMap((entry) => [entry.inet, entry.inet6])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split("/")[0])
    .filter((ip) => ip !== "127.0.0.1" && ip !== "::1" && !ip.startsWith("169.254.") && !ip.toLowerCase().startsWith("fe80:"));
  return candidates.find(isPrivateIpv4) ?? candidates.find((ip) => ipv4Number(ip) !== null) ?? candidates[0] ?? null;
}

export function ipFromLxcConfig(config: Record<string, string | number>): string | null {
  const candidates = Object.entries(config)
    .filter(([key, value]) => /^net\d+$/.test(key) && typeof value === "string")
    .flatMap(([, value]) => [...String(value).matchAll(/(?:^|,)(?:ip|ip6)=([^,/]+)(?:\/\d+)?(?=,|$)/gi)].map((match) => match[1]))
    .filter((ip) => ip && !["dhcp", "auto", "manual"].includes(ip.toLowerCase()));
  return candidates.find(isPrivateIpv4) ?? candidates.find((ip) => ipv4Number(ip) !== null) ?? candidates[0] ?? null;
}

export type PveRuleInput = {
  type: "in" | "out" | "group";
  action: string;
  enable?: number;
  proto?: string;
  dport?: string;
  sport?: string;
  source?: string;
  dest?: string;
  macro?: string;
  comment?: string;
  pos?: number;
  moveto?: number;
};

/** Build a client for a stored node row. */
export function pveClient(node: PveNode, actorId?: string | null): PveClient {
  return new PveClient(node, actorId);
}
