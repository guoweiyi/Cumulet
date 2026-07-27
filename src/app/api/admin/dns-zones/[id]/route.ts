import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  mode: z.enum(["CONFIG_EXPORT", "HTTP_API"]).optional(),
  apiUrl: z.string().url().max(512).nullable().optional(),
  secret: z.string().max(512).optional(),
  clearSecret: z.boolean().optional(),
  tlsVerify: z.boolean().optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_dns_zone");
  const { secret, clearSecret, ...data } = parsed.data;
  const updated = await prisma.dnsZone.updateMany({
    where: { id },
    data: {
      ...data,
      ...(secret ? { secretEnc: encryptSecret(secret) } : clearSecret ? { secretEnc: null } : {}),
    },
  });
  if (!updated.count) throw notFound();
  await audit({ actorId: actor.id, action: "dns.zone.update", targetType: "DnsZone", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const zone = await prisma.dnsZone.findUnique({
    where: { id },
    include: { _count: { select: { records: true } } },
  });
  if (!zone) throw notFound();
  if (zone._count.records) throw badRequest("dns_zone_in_use");
  await prisma.dnsZone.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "dns.zone.delete", targetType: "DnsZone", targetId: id });
  return json({ ok: true });
});
