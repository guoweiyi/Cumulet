import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const patchSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/).optional(),
  name: z.string().trim().min(1).max(128).optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_tenant");
  const updated = await prisma.tenant.updateMany({ where: { id }, data: parsed.data });
  if (!updated.count) throw notFound();
  await audit({ actorId: actor.id, action: "tenant.update", targetType: "Tenant", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { _count: { select: { networks: true, gateways: true, dnsZones: true } } },
  });
  if (!tenant) throw notFound();
  if (tenant._count.networks || tenant._count.gateways || tenant._count.dnsZones) {
    throw badRequest("tenant_not_empty");
  }
  await prisma.tenant.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "tenant.delete", targetType: "Tenant", targetId: id });
  return json({ ok: true });
});

