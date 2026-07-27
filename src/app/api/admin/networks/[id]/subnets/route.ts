import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { validCidr } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const subnetSchema = z.object({
  name: z.string().trim().min(1).max(96),
  cidr: z.string().max(64).refine(validCidr),
  gateway: z.string().max(45).optional(),
  dnsServers: z.array(z.string().max(45)).max(8).optional(),
});

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = subnetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_subnet");
  const version = ipVersion(parsed.data.cidr);
  const subnet = await prisma.subnet.create({
    data: { networkId: id, ...parsed.data, ipVersion: version },
  });
  await audit({ actorId: actor.id, action: "subnet.create", targetType: "Subnet", targetId: subnet.id });
  return json({ subnet }, 201);
});

function ipVersion(cidr: string): "IPV4" | "IPV6" {
  return cidr.includes(":") ? "IPV6" : "IPV4";
}

