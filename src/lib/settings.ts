import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Typed access to the SystemSetting key/value store. Secret members are
 * AES-256-GCM encrypted inside the stored JSON (fields listed in SECRET_FIELDS)
 * and are never returned to the browser (see toClientSafe).
 */

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string; // encrypted at rest
  from: string;
};

export type JumpServerSettings = {
  baseUrl: string;
  orgId: string; // sent as X-JMS-ORG on every request
  authMode: "private_token" | "access_key";
  privateToken: string; // encrypted at rest
  accessKeyId: string;
  accessKeySecret: string; // encrypted at rest
  defaultAccountUsername: string; // login account configured on assets
  autoCreateUsers: boolean;
};

export type DefaultQuotaSettings = {
  maxCpuCores: number;
  maxRamGB: number;
  maxDiskGB: number;
  maxFirewallRules: number;
};

export type ProvisioningSettings = {
  defaultSecurityGroup: string; // PVE security group name
  jumpServerInternalIp: string; // source for the baseline SSH allow rule
};

export type AiSettings = {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number;
  autoCreateAlertTickets: boolean;
  batchSize: number;
};

export type OidcSettings = {
  enabled: boolean;
  providerName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
};

type SettingsMap = {
  smtp: SmtpSettings;
  jumpserver: JumpServerSettings;
  defaultQuota: DefaultQuotaSettings;
  provisioning: ProvisioningSettings;
  ai: AiSettings;
  oidc: OidcSettings;
};

const SECRET_FIELDS: Record<keyof SettingsMap, string[]> = {
  smtp: ["password"],
  jumpserver: ["privateToken", "accessKeySecret"],
  defaultQuota: [],
  provisioning: [],
  ai: ["apiKey"],
  oidc: ["clientSecret"],
};

export const DEFAULTS: { defaultQuota: DefaultQuotaSettings } = {
  defaultQuota: { maxCpuCores: 4, maxRamGB: 8, maxDiskGB: 100, maxFirewallRules: 20 },
};

/** Read a setting with secrets decrypted — server-side use only. */
export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K] | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return null;
  const value = { ...(row.value as Record<string, unknown>) };
  for (const f of SECRET_FIELDS[key]) {
    if (typeof value[f] === "string" && (value[f] as string).length > 0) {
      try {
        value[f] = decryptSecret(value[f] as string);
      } catch {
        value[f] = "";
      }
    }
  }
  return value as SettingsMap[K];
}

/**
 * Persist a setting. Secret fields: empty string means "keep existing"
 * (write-only UI semantics); non-empty values are encrypted.
 */
export async function setSetting<K extends keyof SettingsMap>(
  key: K,
  value: SettingsMap[K],
  updatedById: string,
): Promise<void> {
  const existing = await prisma.systemSetting.findUnique({ where: { key } });
  const stored: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const prior = (existing?.value ?? {}) as Record<string, unknown>;
  for (const f of SECRET_FIELDS[key]) {
    const v = stored[f];
    if (typeof v === "string" && v.length > 0) stored[f] = encryptSecret(v);
    else stored[f] = prior[f] ?? "";
  }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: stored as Prisma.InputJsonValue, updatedById },
    update: { value: stored as Prisma.InputJsonValue, updatedById },
  });
}

/** Strip secret fields for admin UI display (write-only fields come back blank). */
export function toClientSafe<K extends keyof SettingsMap>(
  key: K,
  value: SettingsMap[K] | null,
): Record<string, unknown> | null {
  if (!value) return null;
  const out = { ...(value as Record<string, unknown>) };
  for (const f of SECRET_FIELDS[key]) {
    out[f] = "";
    out[`${f}Set`] = typeof (value as Record<string, unknown>)[f] === "string" &&
      ((value as Record<string, unknown>)[f] as string).length > 0;
  }
  return out;
}

export async function getDefaultQuota(): Promise<DefaultQuotaSettings> {
  const stored = await getSetting("defaultQuota");
  if (!stored) return DEFAULTS.defaultQuota;
  // Read legacy installations once during the rolling migration window.
  const legacy = stored as DefaultQuotaSettings & { maxRamMb?: number; maxDiskGb?: number };
  return {
    maxCpuCores: legacy.maxCpuCores,
    maxRamGB: legacy.maxRamGB ?? Math.max(1, Math.ceil((legacy.maxRamMb ?? 8192) / 1024)),
    maxDiskGB: legacy.maxDiskGB ?? legacy.maxDiskGb ?? 100,
    maxFirewallRules: legacy.maxFirewallRules,
  };
}

/** DB configuration wins; environment values are a migration fallback only. */
export async function getEffectiveOidcSettings(): Promise<OidcSettings | null> {
  const stored = await getSetting("oidc");
  if (stored) return stored;
  const issuer = process.env.OIDC_ISSUER?.trim() ?? "";
  const clientId = process.env.OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.OIDC_CLIENT_SECRET ?? "";
  if (!issuer || !clientId || !clientSecret) return null;
  return { enabled: true, providerName: "SSO", issuer, clientId, clientSecret };
}
