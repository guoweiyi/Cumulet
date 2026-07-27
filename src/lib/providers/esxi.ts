import "server-only";
import type { ProviderInstance } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { ProviderError } from "./errors";
import { ProviderHttpClient } from "./http";
import type { IHypervisorProvider, ProviderResourceRef, ProviderResourceStatus, ProviderTask, ProvisionInput, ProvisionResult, ResizeInput } from "./types";

type EsxiConfig = { baseUrl?: string; username?: string; tlsVerify?: boolean };

export class EsxiProvider implements IHypervisorProvider {
  readonly type = "ESXI" as const;
  private readonly http: ProviderHttpClient;
  private sessionId?: string;
  private readonly username: string;
  private readonly password: string;

  constructor(readonly instanceId: string, instance: ProviderInstance) {
    const config = instance.config as EsxiConfig;
    if (!config.baseUrl) throw new ProviderError("provider_misconfigured", "ESXi baseUrl is required");
    const secret = instance.secretEnc ? decryptSecret(instance.secretEnc) : "";
    let credentials: { username?: string; password?: string } = {};
    try { credentials = JSON.parse(secret); } catch { credentials.password = secret; }
    this.username = credentials.username || config.username || "";
    this.password = credentials.password || "";
    if (!this.username || !this.password) throw new ProviderError("provider_misconfigured", "ESXi credentials are required");
    this.http = new ProviderHttpClient({ baseUrl: config.baseUrl, tlsVerify: config.tlsVerify });
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.sessionId) {
      this.sessionId = await this.http.request<string>("POST", "/api/session", undefined, {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,
      });
    }
    return { "vmware-api-session-id": this.sessionId };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.http.request<T>(method, path, body, await this.authHeaders());
  }

  async healthCheck() {
    await this.request("GET", "/api/vcenter/vm?limit=1");
    return { capabilities: ["status", "power", "cpu-resize", "memory-resize"] };
  }

  async getStatus(resource: ProviderResourceRef): Promise<ProviderResourceStatus> {
    const vm = await this.request<Record<string, unknown>>("GET", `/api/vcenter/vm/${encodeURIComponent(resource.providerResourceId)}`);
    const state = String(vm.power_state || "").toUpperCase();
    return { state: state === "POWERED_ON" ? "running" : state === "POWERED_OFF" ? "stopped" : state === "SUSPENDED" ? "paused" : "unknown", cpuCores: Number(vm.cpu_count) || undefined, ramGB: vm.memory_size_MiB ? Math.ceil(Number(vm.memory_size_MiB) / 1024) : undefined, raw: vm };
  }

  private async power(resource: ProviderResourceRef, action: string): Promise<ProviderTask> {
    await this.request("POST", `/api/vcenter/vm/${encodeURIComponent(resource.providerResourceId)}/power?action=${action}`);
    return { accepted: true };
  }
  powerOn(resource: ProviderResourceRef) { return this.power(resource, "start"); }
  shutdown(resource: ProviderResourceRef) { return this.power(resource, "stop"); }
  reboot(resource: ProviderResourceRef) { return this.power(resource, "reset"); }
  forceStop(resource: ProviderResourceRef) { return this.power(resource, "stop"); }

  async resize(input: ResizeInput): Promise<ProviderTask> {
    const id = encodeURIComponent(input.providerResourceId);
    await this.request("PATCH", `/api/vcenter/vm/${id}/hardware/cpu`, { count: input.cpuCores });
    await this.request("PATCH", `/api/vcenter/vm/${id}/hardware/memory`, { size_MiB: input.ramGB * 1024 });
    return { accepted: true };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    await this.resize(input);
    return { providerResourceId: input.providerResourceId, requiresRestart: true };
  }
}
