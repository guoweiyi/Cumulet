import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(96).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: z.string().max(8192).optional(),
  clearSecret: z.boolean().optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.config && JSON.stringify(parsed.data.config).length > 64 * 1024)) throw badRequest("invalid_provider");
  const { secret, clearSecret, config, ...data } = parsed.data;
  const updated = await prisma.providerInstance.updateMany({
    where: { id },
    data: {
      ...data,
      ...(config ? { config: config as Prisma.InputJsonValue } : {}),
      ...(secret ? { secretEnc: encryptSecret(secret) } : clearSecret ? { secretEnc: null } : {}),
    },
  });
  if (!updated.count) throw notFound();
  await audit({ actorId: actor.id, action: "provider.update", targetType: "ProviderInstance", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const provider = await prisma.providerInstance.findUnique({
    where: { id },
    include: { pveNode: { select: { id: true } }, _count: { select: { resources: true } } },
  });
  if (!provider) throw notFound();
  if (provider.pveNode || provider._count.resources) throw badRequest("provider_in_use");
  await prisma.providerInstance.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "provider.delete", targetType: "ProviderInstance", targetId: id });
  return json({ ok: true });
});

