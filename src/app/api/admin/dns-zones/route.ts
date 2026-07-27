import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  tenantId: z.string().min(1),
  domain: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  mode: z.enum(["CONFIG_EXPORT", "HTTP_API"]).default("CONFIG_EXPORT"),
  apiUrl: z.string().url().max(512).nullable().optional(),
  secret: z.string().max(512).optional(),
  tlsVerify: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.mode === "HTTP_API" && !value.apiUrl) {
    ctx.addIssue({ code: "custom", path: ["apiUrl"], message: "dns_api_url_required" });
  }
});

export const GET = api(async () => {
  await requireAdmin();
  return json({
    zones: (await prisma.dnsZone.findMany({
      orderBy: { domain: "asc" },
      include: { tenant: { select: { id: true, name: true } }, records: true },
    })).map(({ secretEnc, ...zone }) => ({ ...zone, secretSet: !!secretEnc })),
  });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_dns_zone");
  const { secret, ...data } = parsed.data;
  const zone = await prisma.dnsZone.create({
    data: { ...data, secretEnc: secret ? encryptSecret(secret) : null },
  });
  await audit({ actorId: actor.id, action: "dns.zone.create", targetType: "DnsZone", targetId: zone.id });
  return json({ zone: { id: zone.id } }, 201);
});
