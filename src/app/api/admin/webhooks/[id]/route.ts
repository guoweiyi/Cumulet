import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { parseOutboundUrl } from "@/lib/safe-url";

type Ctx = { params: Promise<{ id: string }> };
const EVENTS = ["TICKET_STATUS_CHANGED", "RESOURCE_PROVISIONED", "RESOURCE_EXPIRED", "RESOURCE_PENDING_DELETION"] as const;
const patchSchema = z.object({
  name: z.string().trim().min(1).max(96).optional(),
  url: z.string().url().max(1024).refine((value) => {
    try { parseOutboundUrl(value); return true; } catch { return false; }
  }).optional(),
  tenantId: z.string().min(1).nullable().optional(),
  signingSecret: z.string().min(16).max(512).optional(),
  clearSigningSecret: z.boolean().optional(),
  events: z.array(z.enum(EVENTS)).min(1).max(EVENTS.length).optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_webhook");
  const { signingSecret, clearSigningSecret, ...data } = parsed.data;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound();
  await prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...data,
      ...(signingSecret
        ? { signingSecretEnc: encryptSecret(signingSecret) }
        : clearSigningSecret
          ? { signingSecretEnc: null }
          : {}),
    },
  });
  await audit({ actorId: actor.id, action: "webhook.update", targetType: "WebhookEndpoint", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const deleted = await prisma.webhookEndpoint.deleteMany({ where: { id } });
  if (!deleted.count) throw notFound();
  await audit({ actorId: actor.id, action: "webhook.delete", targetType: "WebhookEndpoint", targetId: id });
  return json({ ok: true });
});
