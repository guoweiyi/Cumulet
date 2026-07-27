import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { getSetting, setSetting, toClientSafe, getDefaultQuota } from "@/lib/settings";

/** All settings, secrets stripped (write-only in the UI). SUPER_ADMIN only. */
export const GET = api(async () => {
  await requireSuperAdmin();
  const [smtp, jumpserver, provisioning, ai, defaultQuota] = await Promise.all([
    getSetting("smtp"),
    getSetting("jumpserver"),
    getSetting("provisioning"),
    getSetting("ai"),
    getDefaultQuota(),
  ]);
  return json({
    smtp: toClientSafe("smtp", smtp),
    jumpserver: toClientSafe("jumpserver", jumpserver),
    provisioning,
    ai: toClientSafe("ai", ai),
    defaultQuota,
  });
});

const smtpSchema = z.object({
  host: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().max(255),
  password: z.string().max(255), // empty = keep existing
  from: z.string().max(255),
});

const jsSchema = z.object({
  baseUrl: z.string().max(255).refine((u) => u === "" || u.startsWith("https://") || u.startsWith("http://")),
  orgId: z.string().max(64),
  authMode: z.enum(["private_token", "access_key"]),
  privateToken: z.string().max(512),
  accessKeyId: z.string().max(128),
  accessKeySecret: z.string().max(512),
  assetNodeId: z.string().max(64),
  defaultAccountUsername: z.string().max(64),
  autoCreateUsers: z.boolean(),
});

const provisioningSchema = z.object({
  defaultSecurityGroup: z.string().max(64),
  jumpServerInternalIp: z.string().max(45),
  portalUrl: z.string().max(255),
});

const quotaSchema = z.object({
  maxCpuCores: z.number().int().min(1).max(256),
  maxRamGB: z.number().int().min(1).max(4096),
  maxDiskGB: z.number().int().min(1).max(1024 * 1024),
  maxFirewallRules: z.number().int().min(0).max(1000),
});

function safeAiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.username || url.password || url.search || url.hash) return false;
    if (["169.254.169.254", "metadata.google.internal"].includes(hostname)) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

const aiSchema = z.object({
  enabled: z.boolean(),
  providerName: z.string().min(1).max(64),
  baseUrl: z.string().url().max(255).refine(safeAiBaseUrl),
  apiKey: z.string().max(512),
  model: z.string().min(1).max(128),
  scheduleEnabled: z.boolean(),
  scheduleIntervalMinutes: z.number().int().min(5).max(10_080),
  autoCreateAlertTickets: z.boolean(),
  batchSize: z.number().int().min(1).max(100),
});

const bodySchema = z.object({
  section: z.enum(["smtp", "jumpserver", "provisioning", "defaultQuota", "ai"]),
  value: z.unknown(),
});

export const PUT = api(async (req: NextRequest) => {
  const user = await requireSuperAdmin();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest();
  const { section, value } = parsed.data;

  switch (section) {
    case "smtp": {
      const v = smtpSchema.safeParse(value);
      if (!v.success) throw badRequest("invalid_smtp");
      await setSetting("smtp", v.data, user.id);
      break;
    }
    case "jumpserver": {
      const v = jsSchema.safeParse(value);
      if (!v.success) throw badRequest("invalid_jumpserver");
      await setSetting("jumpserver", v.data, user.id);
      break;
    }
    case "provisioning": {
      const v = provisioningSchema.safeParse(value);
      if (!v.success) throw badRequest("invalid_provisioning");
      await setSetting("provisioning", v.data, user.id);
      break;
    }
    case "defaultQuota": {
      const v = quotaSchema.safeParse(value);
      if (!v.success) throw badRequest("invalid_quota");
      await setSetting("defaultQuota", v.data, user.id);
      break;
    }
    case "ai": {
      const v = aiSchema.safeParse(value);
      if (!v.success) throw badRequest("invalid_ai");
      await setSetting("ai", v.data, user.id);
      break;
    }
  }
  await audit({ actorId: user.id, action: "settings.update", targetType: "SystemSetting", targetId: section });
  return json({ ok: true });
});
