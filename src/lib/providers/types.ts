import type { ProviderType } from "@prisma/client";

export type ProviderResourceRef = {
  providerResourceId: string;
};

export type ProvisionInput = ProviderResourceRef & {
  displayName: string;
  cpuCores: number;
  ramGB: number;
  diskGB: number;
  cloudInit?: {
    username: string;
    password: string;
    sshKeys?: string;
    ipConfig?: string;
    nameserver?: string;
  };
};

export type ProvisionResult = ProviderResourceRef & {
  taskId?: string;
  requiresRestart: boolean;
};

export type ProviderTask = {
  taskId?: string;
  accepted: boolean;
};

export type ProviderResourceStatus = {
  state: "running" | "stopped" | "paused" | "unknown";
  cpuCores?: number;
  ramGB?: number;
  diskGB?: number;
  raw?: Readonly<Record<string, unknown>>;
};

export type ResizeInput = ProviderResourceRef & {
  cpuCores: number;
  ramGB: number;
  diskGB: number;
};

/**
 * Stable contract implemented by every compute backend. Provider-specific
 * capabilities live in optional extension interfaces, not in core workflows.
 */
export interface IHypervisorProvider {
  readonly type: ProviderType;
  readonly instanceId: string;

  provision(input: ProvisionInput): Promise<ProvisionResult>;
  getStatus(resource: ProviderResourceRef): Promise<ProviderResourceStatus>;
  powerOn(resource: ProviderResourceRef): Promise<ProviderTask>;
  shutdown(resource: ProviderResourceRef): Promise<ProviderTask>;
  reboot(resource: ProviderResourceRef): Promise<ProviderTask>;
  forceStop(resource: ProviderResourceRef): Promise<ProviderTask>;
  resize(input: ResizeInput): Promise<ProviderTask>;
}

