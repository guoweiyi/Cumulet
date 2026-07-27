import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const memberSchema = z.object({ userId: z.string().min(1), role: z.enum(["MEMBER", "MANAGER"]).default("MEMBER") });

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) throw notFound();
  return json({
    members: await prisma.tenantMembership.findMany({
      where: { tenantId: id },
      include: { user: { select: { id: true, email: true, nickname: true, realName: true } } },
    }),
  });
});

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = memberSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_member");
  const membership = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: id, userId: parsed.data.userId } },
    create: { tenantId: id, ...parsed.data },
    update: { role: parsed.data.role },
  });
  await audit({ actorId: actor.id, action: "tenant.member.upsert", targetType: "Tenant", targetId: id, metadata: { userId: parsed.data.userId, role: parsed.data.role } });
  return json({ membership }, 201);
});

