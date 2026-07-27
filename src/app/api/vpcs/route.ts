import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireOnboardedUser } from "@/lib/guards";
import { validCidr } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().trim().min(1).max(96),
  subnetName: z.string().trim().min(1).max(96).default("default"),
  cidr: z.string().trim().min(3).max(64),
  gateway: z.string().trim().max(45).optional(),
});

export const GET = api(async () => {
  const user = await requireOnboardedUser();
  const vpcs = await prisma.network.findMany({
    where: { tenant: { memberships: { some: { userId: user.id } } } },
    include: {
      tenant: { select: { id: true, name: true } },
      subnets: { orderBy: { createdAt: "asc" }, include: { _count: { select: { attachments: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return json({ vpcs });
});

export const POST = api(async (req: NextRequest) => {
  const user = await requireOnboardedUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !validCidr(parsed.data.cidr)) throw badRequest("invalid_vpc");
  const { name, subnetName, cidr, gateway } = parsed.data;
  const personalSlug = `user-${user.id}`;
  const vpc = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.upsert({
      where: { slug: personalSlug },
      create: {
        slug: personalSlug,
        name: user.nickname || user.realName || user.email,
        createdById: user.id,
        memberships: { create: { userId: user.id, role: "MANAGER" } },
      },
      update: {},
    });
    const existing = await tx.network.findUnique({ where: { tenantId_name: { tenantId: tenant.id, name } }, select: { id: true } });
    if (existing) throw badRequest("vpc_name_in_use");
    return tx.network.create({
      data: {
        tenantId: tenant.id,
        name,
        routingDomain: `vpc-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        createdById: user.id,
        subnets: { create: { name: subnetName, cidr, gateway: gateway || null, ipVersion: cidr.includes(":") ? "IPV6" : "IPV4" } },
      },
      include: { subnets: true },
    });
  });
  await audit({ actorId: user.id, action: "vpc.create", targetType: "Network", targetId: vpc.id });
  return json({ vpc }, 201);
});
