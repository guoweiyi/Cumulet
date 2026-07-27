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
  ) {
    super(message);
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
      throw new PveError(0, `PVE unreachable: ${err instanceof Error ? err.message : "network error"}`);
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
      throw new PveError(res.status, `PVE ${res.status}: ${detail}`);
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

  // --- VM lifecycle ---------------------------------------------------------

  vmStatus(vmid: number): Promise<VmCurrentStatus> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/status/current`);
  }

  vmConfig(vmid: number): Promise<Record<string, string | number>> {
    return this.request("GET", `/nodes/${this.node.nodeName}/qemu/${vmid}/config`);
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
