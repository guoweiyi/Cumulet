import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(96).optional(),
  apiUrl: z.string().url().max(512).nullable().optional(),
  publicHost: z.string().trim().min(1).max(255).optional(),
  secret: z.string().max(512).optional(),
  clearSecret: z.boolean().optional(),
  tlsVerify: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_gateway");
  const { secret, clearSecret, ...data } = parsed.data;
  const updated = await prisma.reverseProxyGateway.updateMany({
    where: { id },
    data: {
      ...data,
      ...(secret ? { secretEnc: encryptSecret(secret) } : clearSecret ? { secretEnc: null } : {}),
    },
  });
  if (!updated.count) throw notFound();
  await audit({ actorId: actor.id, action: "network.gateway.update", targetType: "ReverseProxyGateway", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const gateway = await prisma.reverseProxyGateway.findUnique({ where: { id }, include: { _count: { select: { mappings: true } } } });
  if (!gateway) throw notFound();
  if (gateway._count.mappings) throw badRequest("gateway_in_use");
  await prisma.reverseProxyGateway.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "network.gateway.delete", targetType: "ReverseProxyGateway", targetId: id });
  return json({ ok: true });
});
