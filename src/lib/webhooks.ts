import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { fetch as ufetch } from "undici";
import { Prisma, type WebhookEventType } from "@prisma/client";
import { audit } from "./audit";
import { decryptSecret } from "./crypto";
import { prisma } from "./prisma";
import { safeDispatcher } from "./safe-url";

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 6;
const MAX_ENDPOINTS_PER_EVENT = 100;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];

export type WebhookEnvelope<T = unknown> = {
  id: string;
  type: WebhookEventType;
  occurredAt: string;
  data: T;
};

function subscriptions(value: Prisma.JsonValue): WebhookEventType[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is WebhookEventType => typeof entry === "string")
    : [];
}

export async function dispatchWebhookEvent<T>(input: {
  type: WebhookEventType;
  data: T;
  tenantIds?: string[];
}): Promise<{ eventId: string; queued: number; delivered: number }> {
  const envelope: WebhookEnvelope<T> = {
    id: randomUUID(),
    type: input.type,
    occurredAt: new Date().toISOString(),
    data: input.data,
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) throw new Error("webhook_payload_too_large");

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      enabled: true,
      OR: [
        { tenantId: null },
        ...(input.tenantIds?.length ? [{ tenantId: { in: input.tenantIds } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ENDPOINTS_PER_EVENT,
  });
  const subscribed = endpoints.filter((endpoint) => subscriptions(endpoint.events).includes(input.type));
  if (!subscribed.length) return { eventId: envelope.id, queued: 0, delivered: 0 };

  const deliveries = await prisma.$transaction(
    subscribed.map((endpoint) =>
      prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventId: envelope.id,
          eventType: input.type,
          payload: envelope as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  return {
    eventId: envelope.id,
    queued: deliveries.length,
    delivered: 0,
  };
}

export async function deliverWebhookDelivery(deliveryId: string): Promise<boolean> {
  const claimed = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "PENDING", nextAttemptAt: { lte: new Date() } },
    data: { status: "DELIVERING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return false;
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return false;

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = delivery.endpoint.signingSecretEnc
    ? decryptSecret(delivery.endpoint.signingSecretEnc)
    : "";
  const signature = secret
    ? `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`
    : "";
  let dispatcher: Awaited<ReturnType<typeof safeDispatcher>>["dispatcher"] | undefined;
  try {
    const resolved = await safeDispatcher(delivery.endpoint.url);
    dispatcher = resolved.dispatcher;
    const response = await ufetch(resolved.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Cumulet-Webhook/1.0",
        "X-Cumulet-Event": delivery.eventType,
        "X-Cumulet-Delivery": delivery.id,
        "X-Cumulet-Timestamp": timestamp,
        ...(signature ? { "X-Cumulet-Signature": signature } : {}),
      },
      body,
      dispatcher,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Object.assign(new Error(`webhook_http_${response.status}`), { status: response.status });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SUCCESS",
        responseStatus: response.status,
        deliveredAt: new Date(),
        errorMessage: null,
      },
    });
    await audit({
      action: "webhook.delivery.success",
      targetType: "WebhookDelivery",
      targetId: delivery.id,
      metadata: { endpointId: delivery.endpointId, eventType: delivery.eventType },
    });
    return true;
  } catch (error) {
    const attempts = delivery.attempts;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const status = (error as { status?: unknown } | null)?.status;
    const code = typeof status === "number"
      ? `webhook_http_${status}`
      : error instanceof Error
        ? error.message.slice(0, 200)
        : "webhook_failed";
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        responseStatus: typeof status === "number" ? status : null,
        errorMessage: code,
        nextAttemptAt: new Date(Date.now() + (RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)] ?? 12 * 3_600_000)),
      },
    });
    await audit({
      action: "webhook.delivery.failed",
      targetType: "WebhookDelivery",
      targetId: delivery.id,
      metadata: { endpointId: delivery.endpointId, eventType: delivery.eventType, error: code },
    });
    return false;
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

export async function retryPendingWebhookDeliveries(limit = 50) {
  const pending = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });
  const results = await Promise.allSettled(pending.map(({ id }) => deliverWebhookDelivery(id)));
  return {
    processed: pending.length,
    delivered: results.filter((result) => result.status === "fulfilled" && result.value).length,
  };
}

export async function tenantIdsForUser(userId: string): Promise<string[]> {
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId },
    select: { tenantId: true },
  });
  return memberships.map(({ tenantId }) => tenantId);
}

export async function emitTicketStatusChanged(input: {
  ticketId: string;
  userId: string;
  previousStatus: string;
  status: string;
}): Promise<void> {
  const tenantIds = await tenantIdsForUser(input.userId);
  await dispatchWebhookEvent({
    type: "TICKET_STATUS_CHANGED",
    tenantIds,
    data: input,
  });
}

export async function emitResourceProvisioned(input: {
  resourceId: string;
  ticketId: string;
  ownerId: string;
  providerId: string;
  providerResourceId: string;
}): Promise<void> {
  const tenantIds = await tenantIdsForUser(input.ownerId);
  await dispatchWebhookEvent({
    type: "RESOURCE_PROVISIONED",
    tenantIds,
    data: input,
  });
}
