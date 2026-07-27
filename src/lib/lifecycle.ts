import "server-only";
import { Prisma } from "@prisma/client";
import { audit } from "./audit";
import { emailLeaseWarning } from "./emails";
import { getHypervisorProvider } from "./providers";
import { prisma } from "./prisma";
import { dispatchWebhookEvent, tenantIdsForUser } from "./webhooks";

const DAY_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;

async function acquireLease(holderId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  try {
    await prisma.jobLease.create({ data: { key: "resource-lifecycle", holderId, expiresAt } });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const claimed = await prisma.jobLease.updateMany({
    where: { key: "resource-lifecycle", expiresAt: { lt: now } },
    data: { holderId, expiresAt },
  });
  return claimed.count === 1;
}

async function releaseLease(holderId: string): Promise<void> {
  await prisma.jobLease.deleteMany({
    where: { key: "resource-lifecycle", holderId },
  });
}

async function sendWarnings(now: Date): Promise<number> {
  const resources = await prisma.provisionedResource.findMany({
    where: {
      status: "ACTIVE",
      warningSentAt: null,
      expiresAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY_MS) },
    },
    include: { owner: { select: { id: true, email: true } } },
    take: 100,
  });
  let warned = 0;
  for (const resource of resources) {
    if (await emailLeaseWarning(resource.owner.id, resource.owner.email, resource.displayName, resource.expiresAt)) {
      const marked = await prisma.provisionedResource.updateMany({
        where: { id: resource.id, warningSentAt: null, status: "ACTIVE" },
        data: { warningSentAt: new Date() },
      });
      warned += marked.count;
    }
  }
  return warned;
}

async function expireResources(now: Date): Promise<{ expired: number; failures: number }> {
  const resources = await prisma.provisionedResource.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: 50,
  });
  let expired = 0;
  let failures = 0;
  for (const resource of resources) {
    try {
      const provider = await getHypervisorProvider(resource.providerId, null);
      await provider.shutdown({ providerResourceId: resource.providerResourceId });
      const updated = await prisma.provisionedResource.updateMany({
        where: { id: resource.id, status: "ACTIVE" },
        data: {
          status: "EXPIRED",
          expiredAt: now,
          deletionDueAt: new Date(now.getTime() + 7 * DAY_MS),
        },
      });
      if (!updated.count) continue;
      expired += 1;
      await audit({ action: "resource.lease.expired", targetType: "ProvisionedResource", targetId: resource.id });
      const tenantIds = await tenantIdsForUser(resource.ownerId);
      await dispatchWebhookEvent({
        type: "RESOURCE_EXPIRED",
        tenantIds,
        data: { resourceId: resource.id, ownerId: resource.ownerId, expiredAt: now.toISOString() },
      });
    } catch (error) {
      failures += 1;
      await audit({
        action: "resource.lease.expiration_failed",
        targetType: "ProvisionedResource",
        targetId: resource.id,
        metadata: { error: error instanceof Error ? error.message.slice(0, 200) : "provider_failed" },
      });
    }
  }
  return { expired, failures };
}

async function markPendingDeletion(now: Date): Promise<number> {
  const due = await prisma.provisionedResource.findMany({
    where: { status: "EXPIRED", deletionDueAt: { lte: now } },
    take: 100,
  });
  let marked = 0;
  for (const resource of due) {
    const updated = await prisma.provisionedResource.updateMany({
      where: { id: resource.id, status: "EXPIRED" },
      data: { status: "PENDING_DELETION" },
    });
    if (!updated.count) continue;
    marked += 1;
    await audit({ action: "resource.lease.pending_deletion", targetType: "ProvisionedResource", targetId: resource.id });
    const tenantIds = await tenantIdsForUser(resource.ownerId);
    await dispatchWebhookEvent({
      type: "RESOURCE_PENDING_DELETION",
      tenantIds,
      data: { resourceId: resource.id, ownerId: resource.ownerId, deletionDueAt: resource.deletionDueAt?.toISOString() },
    });
  }
  return marked;
}

export async function runResourceLifecycle(holderId: string) {
  if (!(await acquireLease(holderId))) return { skipped: "lease_held", warned: 0, expired: 0, marked: 0, failures: 0 };
  try {
    const now = new Date();
    const warned = await sendWarnings(now);
    const expiration = await expireResources(now);
    const marked = await markPendingDeletion(now);
    return { warned, expired: expiration.expired, marked, failures: expiration.failures };
  } finally {
    await releaseLease(holderId);
  }
}
