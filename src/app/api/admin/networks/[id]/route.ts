import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(96).optional(),
  routingDomain: z.string().trim().min(1).max(96).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_network");
  const updated = await prisma.network.updateMany({ where: { id }, data: parsed.data });
  if (!updated.count) throw notFound();
  await audit({ actorId: actor.id, action: "network.update", targetType: "Network", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const network = await prisma.network.findUnique({ where: { id }, include: { subnets: { include: { _count: { select: { attachments: true } } } } } });
  if (!network) throw notFound();
  if (network.subnets.some((subnet) => subnet._count.attachments > 0)) throw badRequest("network_in_use");
  await prisma.network.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "network.delete", targetType: "Network", targetId: id });
  return json({ ok: true });
});

