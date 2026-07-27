import type { Prisma } from "@prisma/client";
import { ApiError } from "./api";
import { prisma } from "./prisma";
import { getDefaultQuota } from "./settings";

export type Quota = {
  maxCpuCores: number;
  maxRamGB: number;
  maxDiskGB: number;
  maxFirewallRules: number;
};

/** Effective quota for a user: their row, else system defaults. */
export async function getUserQuota(userId: string): Promise<Quota> {
  const row = await prisma.userQuota.findUnique({ where: { userId } });
  if (row) {
    return {
      maxCpuCores: row.maxCpuCores,
      maxRamGB: row.maxRamGB,
      maxDiskGB: row.maxDiskGB,
      maxFirewallRules: row.maxFirewallRules,
    };
  }
  return getDefaultQuota();
}

export type ResourceCapacity = {
  cpuCores: number;
  ramGB: number;
  diskGB: number;
};

function finitePositive(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export function requestedCapacity(
  values: unknown,
  observed: Partial<ResourceCapacity> = {},
): ResourceCapacity {
  const record = values && typeof values === "object" && !Array.isArray(values)
    ? (values as Record<string, unknown>)
    : {};
  const cpuCores = finitePositive(record, ["cpu_cores", "cpuCores", "cores"]) ?? observed.cpuCores;
  const ramGB = finitePositive(record, ["ram_gb", "ramGB", "memory_gb"]) ?? observed.ramGB;
  const diskGB = finitePositive(record, ["disk_gb", "diskGB", "storage_gb"]) ?? observed.diskGB;
  if (!cpuCores || !ramGB || !diskGB) {
    throw new ApiError(422, "resource_capacity_missing");
  }
  return {
    cpuCores: Math.ceil(cpuCores),
    ramGB: Math.ceil(ramGB),
    diskGB: Math.ceil(diskGB),
  };
}

const COUNTED_STATUSES = [
  "PROVISIONING",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "PENDING_DELETION",
] as const;

/** Aggregate allocations and reject an approval that would exceed quota. */
export async function assertQuotaAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
  requested: ResourceCapacity,
  fallback: Quota,
): Promise<void> {
  const [specific, usage] = await Promise.all([
    tx.userQuota.findUnique({ where: { userId } }),
    tx.provisionedResource.aggregate({
      where: { ownerId: userId, status: { in: [...COUNTED_STATUSES] } },
      _sum: { cpuCores: true, ramGB: true, diskGB: true },
    }),
  ]);
  const quota = specific ?? fallback;
  const next = {
    cpuCores: (usage._sum.cpuCores ?? 0) + requested.cpuCores,
    ramGB: (usage._sum.ramGB ?? 0) + requested.ramGB,
    diskGB: (usage._sum.diskGB ?? 0) + requested.diskGB,
  };
  if (
    next.cpuCores > quota.maxCpuCores ||
    next.ramGB > quota.maxRamGB ||
    next.diskGB > quota.maxDiskGB
  ) {
    throw new ApiError(422, "over_quota", JSON.stringify({ quota, usage: next }));
  }
}
