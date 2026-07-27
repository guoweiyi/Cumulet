import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { addressInCidr, assertResourceSubnetTenant } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ subnetId: z.string().min(1), ipAddress: z.string().min(2).max(45), isPrimary: z.boolean().default(false) });

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_attachment");
  const subnet = await prisma.subnet.findUnique({
    where: { id: parsed.data.subnetId },
    include: { network: true },
  });
  if (!subnet) throw notFound();
  try {
    await assertResourceSubnetTenant(id, parsed.data.subnetId);
  } catch {
    throw badRequest("resource_owner_not_in_tenant");
  }
  if (!addressInCidr(parsed.data.ipAddress, subnet.cidr)) throw badRequest("address_outside_subnet");
  const attachment = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.resourceNetworkAttachment.updateMany({ where: { resourceId: id }, data: { isPrimary: false } });
    }
    return tx.resourceNetworkAttachment.create({ data: { resourceId: id, ...parsed.data } });
  });
  await audit({ actorId: actor.id, action: "network.attachment.create", targetType: "ProvisionedResource", targetId: id, metadata: { subnetId: subnet.id, ipAddress: parsed.data.ipAddress } });
  return json({ attachment }, 201);
});
