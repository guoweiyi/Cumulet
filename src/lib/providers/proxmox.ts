import "server-only";
import type { PveNode } from "@prisma/client";
import { PveClient, PveError } from "@/lib/pve";
import { ProviderError } from "./errors";
import type {
  IHypervisorProvider,
  ProviderResourceRef,
  ProviderResourceStatus,
  ProviderTask,
  ProvisionInput,
  ProvisionResult,
  ResizeInput,
} from "./types";

const BOOT_DISK_KEYS = ["scsi0", "virtio0", "sata0", "ide0"] as const;

function vmidOf(resource: ProviderResourceRef): number {
  const vmid = Number(resource.providerResourceId);
  if (!Number.isInteger(vmid) || vmid < 100 || vmid > 999_999_999) {
    throw new ProviderError("invalid_resource_id", "Invalid Proxmox VM identifier");
  }
  return vmid;
}

function mapError(error: unknown): never {
  if (error instanceof ProviderError) throw error;
  if (error instanceof PveError) {
    const code = error.status === 403
      ? "provider_permission_denied"
      : error.status > 0 ? `provider_http_${error.status}` : "provider_unreachable";
    throw new ProviderError(
      code,
      error.message,
      error,
    );
  }
  throw new ProviderError("provider_operation_failed", "Proxmox operation failed", error);
}

function bootDisk(config: Record<string, string | number>): { key: string; sizeGB: number } | null {
  for (const key of BOOT_DISK_KEYS) {
    const raw = config[key];
    if (typeof raw !== "string" || raw.startsWith("none")) continue;
    const match = raw.match(/size=(\d+(?:\.\d+)?)([MGT])/);
    if (!match) return { key, sizeGB: 0 };
    const value = Number(match[1]);
    const sizeGB = match[2] === "T" ? value * 1024 : match[2] === "M" ? value / 1024 : value;
    return { key, sizeGB: Math.round(sizeGB) };
  }
  return null;
}

/**
 * PVE validates the VM `name` as a DNS hostname and rejects underscores,
 * uppercase letters and other characters. The platform's display name uses
 * `owner_resource` form, so derive a DNS-safe VM name for PVE only; the
 * operator-facing display name is left untouched.
 */
function pveVmName(displayName: string, vmid: number): string {
  const cleaned = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return cleaned || `vm-${vmid}`;
}

export class ProxmoxProvider implements IHypervisorProvider {
  readonly type = "PROXMOX" as const;

  constructor(
    readonly instanceId: string,
    private readonly client: PveClient,
  ) {}

  static fromNode(instanceId: string, node: PveNode, actorId?: string | null): ProxmoxProvider {
    return new ProxmoxProvider(instanceId, new PveClient(node, actorId));
  }

  async healthCheck() {
    try {
      const version = await this.client.version();
      await this.client.listNodeVms();
      return { version: version.version, capabilities: ["status", "power", "resize", "cloud-init", "firewall", "guest-agent"] };
    } catch (error) {
      mapError(error);
    }
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const vmid = vmidOf(input);
    try {
      await this.client.vmStatus(vmid);
      const resizeTask = await this.resize(input);
      await this.client.setConfig(vmid, { name: pveVmName(input.displayName, vmid) });
      const cloudInit = input.cloudInit;
      if (cloudInit) {
        await this.client.setConfig(vmid, {
          ciuser: cloudInit.username,
          cipassword: cloudInit.password,
          sshkeys: cloudInit.sshKeys || undefined,
          ipconfig0: cloudInit.ipConfig || undefined,
          nameserver: cloudInit.nameserver || undefined,
        });
        await this.client.regenerateCloudInit(vmid);
      }
      const taskId = await this.client.power(vmid, "reboot").catch(async (error) => {
        if (error instanceof PveError && [400, 500].includes(error.status)) {
          return this.client.power(vmid, "start");
        }
        throw error;
      });
      return {
        providerResourceId: input.providerResourceId,
        taskId: taskId ?? resizeTask.taskId,
        requiresRestart: true,
      };
    } catch (error) {
      mapError(error);
    }
  }

  async getStatus(resource: ProviderResourceRef): Promise<ProviderResourceStatus> {
    try {
      const status = await this.client.vmStatus(vmidOf(resource));
      const state = ["running", "stopped", "paused"].includes(status.status)
        ? (status.status as "running" | "stopped" | "paused")
        : "unknown";
      return {
        state,
        cpuCores: status.cpus,
        ramGB: status.maxmem ? Math.ceil(status.maxmem / 1024 ** 3) : undefined,
        diskGB: status.maxdisk ? Math.ceil(status.maxdisk / 1024 ** 3) : undefined,
        raw: status,
      };
    } catch (error) {
      mapError(error);
    }
  }

  powerOn(resource: ProviderResourceRef): Promise<ProviderTask> {
    return this.power(resource, "start");
  }

  shutdown(resource: ProviderResourceRef): Promise<ProviderTask> {
    return this.power(resource, "shutdown");
  }

  reboot(resource: ProviderResourceRef): Promise<ProviderTask> {
    return this.power(resource, "reboot");
  }

  forceStop(resource: ProviderResourceRef): Promise<ProviderTask> {
    return this.power(resource, "stop");
  }

  private async power(
    resource: ProviderResourceRef,
    action: "start" | "shutdown" | "reboot" | "stop",
  ): Promise<ProviderTask> {
    try {
      const taskId = await this.client.power(vmidOf(resource), action);
      return { taskId, accepted: true };
    } catch (error) {
      mapError(error);
    }
  }

  async resize(input: ResizeInput): Promise<ProviderTask> {
    const vmid = vmidOf(input);
    try {
      const config = await this.client.vmConfig(vmid);
      const disk = bootDisk(config);
      if (disk && input.diskGB < disk.sizeGB) {
        throw new ProviderError("disk_shrink_forbidden", "Disk shrinking is not supported");
      }
      await this.client.setConfig(vmid, {
        cores: input.cpuCores,
        memory: input.ramGB * 1024,
      });
      let taskId: string | undefined;
      if (disk && input.diskGB > disk.sizeGB) {
        taskId = await this.client.resizeDisk(vmid, disk.key, input.diskGB);
      }
      return { taskId, accepted: true };
    } catch (error) {
      mapError(error);
    }
  }
}
