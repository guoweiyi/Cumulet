import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { groupNameSchema, onAllNodes } from "@/lib/firewall-admin";

type Ctx = { params: Promise<{ name: string }> };

const patchSchema = z.object({
  description: z.object({ zh: z.string().max(200), en: z.string().max(200).optional() }).nullish(),
  scope: z.enum(["ADMIN_ONLY", "SHARED"]).optional(),
  isProvisioningDefault: z.boolean().optional(),
});

/** Update metadata (visibility/default) — rules live in PVE. */
export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();
  const group = await prisma.securityGroup.findUnique({ where: { name } });
  if (!group) throw notFound();

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest();
  const { description, scope, isProvisioningDefault } = parsed.data;

  if (isProvisioningDefault === true) {
    await prisma.securityGroup.updateMany({ data: { isProvisioningDefault: false } });
  }
  await prisma.securityGroup.update({
    where: { name },
    data: {
      ...(description !== undefined
        ? { description: (description ?? Prisma.JsonNull) as Prisma.InputJsonValue }
        : {}),
      ...(scope ? { scope } : {}),
      ...(isProvisioningDefault !== undefined ? { isProvisioningDefault } : {}),
    },
  });
  await audit({
    actorId: user.id,
    action: "firewall.sg.update",
    targetType: "SecurityGroup",
    targetId: name,
    metadata: parsed.data,
  });
  return json({ ok: true });
});

/** Delete from every PVE node and the metadata table. */
export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();

  const { failures } = await onAllNodes(user.id, async (client) => {
    const existing = await client.listGroups();
    if (existing.some((g) => g.group === name)) {
      await client.deleteGroup(name);
    }
  });
  if (failures.length > 0) {
    // e.g. still referenced by a VM — surface the PVE error, keep metadata.
    return json({ ok: false, failures }, 409);
  }
  await prisma.securityGroup.deleteMany({ where: { name } });
  await audit({
    actorId: user.id,
    action: "firewall.sg.delete",
    targetType: "SecurityGroup",
    targetId: name,
  });
  return json({ ok: true });
});
