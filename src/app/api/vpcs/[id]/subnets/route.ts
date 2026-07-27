import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireOnboardedUser } from "@/lib/guards";
import { validCidr } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ name: z.string().trim().min(1).max(96), cidr: z.string().trim().min(3).max(64), gateway: z.string().trim().max(45).optional() });

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireOnboardedUser();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !validCidr(parsed.data.cidr)) throw badRequest("invalid_subnet");
  const vpc = await prisma.network.findFirst({
    where: { id, tenant: { memberships: { some: { userId: user.id, role: "MANAGER" } } } },
    select: { id: true },
  });
  if (!vpc) throw notFound();
  const subnet = await prisma.subnet.create({
    data: { networkId: id, name: parsed.data.name, cidr: parsed.data.cidr, gateway: parsed.data.gateway || null, ipVersion: parsed.data.cidr.includes(":") ? "IPV6" : "IPV4" },
  });
  await audit({ actorId: user.id, action: "vpc.subnet.create", targetType: "Subnet", targetId: subnet.id });
  return json({ subnet }, 201);
});
