import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { parseOutboundUrl } from "@/lib/safe-url";

const EVENTS = [
  "TICKET_STATUS_CHANGED",
  "RESOURCE_PROVISIONED",
  "RESOURCE_EXPIRED",
  "RESOURCE_PENDING_DELETION",
] as const;

const endpointSchema = z.object({
  name: z.string().trim().min(1).max(96),
  url: z.string().url().max(1024).refine((value) => {
    try { parseOutboundUrl(value); return true; } catch { return false; }
  }, "invalid_webhook_url"),
  tenantId: z.string().min(1).nullable().optional(),
  signingSecret: z.string().min(16).max(512).optional(),
  events: z.array(z.enum(EVENTS)).min(1).max(EVENTS.length),
  enabled: z.boolean().default(true),
});

/**
 * @swagger
 * /api/admin/webhooks:
 *   get:
 *     tags: [Webhooks]
 *     summary: List webhook subscriptions without secret values
 *     responses:
 *       200: { description: Webhook collection }
 *   post:
 *     tags: [Webhooks]
 *     summary: Create a signed webhook subscription
 *     responses:
 *       201: { description: Webhook created }
 *       400: { description: Invalid or unsafe URL }
 */

export const GET = api(async () => {
  await requireAdmin();
  const endpoints = await prisma.webhookEndpoint.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, url: true, tenantId: true, events: true, enabled: true,
      createdAt: true, updatedAt: true, signingSecretEnc: true,
      _count: { select: { deliveries: true } },
    },
  });
  return json({
    endpoints: endpoints.map(({ signingSecretEnc, ...endpoint }) => ({
      ...endpoint,
      signingSecretSet: !!signingSecretEnc,
    })),
  });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = endpointSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_webhook");
  const { signingSecret, ...data } = parsed.data;
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ...data,
      events: data.events,
      signingSecretEnc: signingSecret ? encryptSecret(signingSecret) : null,
      createdById: actor.id,
    },
    select: { id: true },
  });
  await audit({ actorId: actor.id, action: "webhook.create", targetType: "WebhookEndpoint", targetId: endpoint.id });
  return json({ endpoint }, 201);
});
