import "server-only";
import type { ProviderInstance } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { ProviderError } from "./errors";
import { ProviderHttpClient } from "./http";
import type { IHypervisorProvider, ProviderResourceRef, ProviderResourceStatus, ProviderTask, ProvisionInput, ProvisionResult, ResizeInput } from "./types";

type FnosConfig = {
  baseUrl?: string;
  tlsVerify?: boolean;
  healthPath?: string;
  statusPath?: string;
  powerPath?: string;
  resizePath?: string;
};

/** FNOS virtualization APIs vary by release; endpoint templates keep the adapter explicit and testable. */
export class FnosProvider implements IHypervisorProvider {
  readonly type = "FNOS" as const;
  private readonly http: ProviderHttpClient;
  private readonly config: Required<Pick<FnosConfig, "healthPath" | "statusPath" | "powerPath" | "resizePath">>;

  constructor(readonly instanceId: string, instance: ProviderInstance) {
    const raw = instance.config as FnosConfig;
    if (!raw.baseUrl) throw new ProviderError("provider_misconfigured", "FNOS baseUrl is required");
    const token = instance.secretEnc ? decryptSecret(instance.secretEnc) : "";
    this.http = new ProviderHttpClient({ baseUrl: raw.baseUrl, tlsVerify: raw.tlsVerify, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    this.config = {
      healthPath: raw.healthPath || "/api/v1/system/info",
      statusPath: raw.statusPath || "/api/v1/vms/{id}",
      powerPath: raw.powerPath || "/api/v1/vms/{id}/power",
      resizePath: raw.resizePath || "/api/v1/vms/{id}/hardware",
    };
  }
  private path(template: string, id: string) { return template.replace("{id}", encodeURIComponent(id)); }
  async healthCheck() { await this.http.request("GET", this.config.healthPath); return { capabilities: ["status", "power", "resize", "configurable-endpoints"] }; }
  async getStatus(resource: ProviderResourceRef): Promise<ProviderResourceStatus> {
    const vm = await this.http.request<Record<string, unknown>>("GET", this.path(this.config.statusPath, resource.providerResourceId));
    const rawState = String(vm.status || vm.state || "unknown").toLowerCase();
    return { state: rawState.includes("run") ? "running" : rawState.includes("stop") || rawState.includes("off") ? "stopped" : rawState.includes("pause") ? "paused" : "unknown", cpuCores: Number(vm.cpuCores || vm.cpu) || undefined, ramGB: Number(vm.ramGB || vm.memoryGB) || undefined, diskGB: Number(vm.diskGB) || undefined, raw: vm };
  }
  private async power(resource: ProviderResourceRef, action: string): Promise<ProviderTask> { await this.http.request("POST", this.path(this.config.powerPath, resource.providerResourceId), { action }); return { accepted: true }; }
  powerOn(r: ProviderResourceRef) { return this.power(r, "start"); }
  shutdown(r: ProviderResourceRef) { return this.power(r, "shutdown"); }
  reboot(r: ProviderResourceRef) { return this.power(r, "reboot"); }
  forceStop(r: ProviderResourceRef) { return this.power(r, "stop"); }
  async resize(input: ResizeInput): Promise<ProviderTask> { await this.http.request("PATCH", this.path(this.config.resizePath, input.providerResourceId), { cpuCores: input.cpuCores, ramGB: input.ramGB, diskGB: input.diskGB }); return { accepted: true }; }
  async provision(input: ProvisionInput): Promise<ProvisionResult> { await this.resize(input); return { providerResourceId: input.providerResourceId, requiresRestart: true }; }
}
