import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { firstClient, groupNameSchema, onAllNodes } from "@/lib/firewall-admin";
import { mapPveError } from "@/lib/vm";

/** Merge PVE cluster groups with local metadata (scope/default/description). */
export const GET = api(async () => {
  const user = await requireAdmin();
  try {
    const [pveGroups, meta] = await Promise.all([
      firstClient(user.id).then((c) => c.listGroups()),
      prisma.securityGroup.findMany(),
    ]);
    const metaByName = new Map(meta.map((m) => [m.name, m]));
    const names = new Set([...pveGroups.map((g) => g.group), ...meta.map((m) => m.name)]);
    const groups = [...names].map((name) => {
      const m = metaByName.get(name);
      return {
        name,
        inPve: pveGroups.some((g) => g.group === name),
        comment: pveGroups.find((g) => g.group === name)?.comment ?? null,
        description: m?.description ?? null,
        scope: m?.scope ?? "ADMIN_ONLY",
        isProvisioningDefault: m?.isProvisioningDefault ?? false,
        lastSyncedAt: m?.lastSyncedAt?.toISOString() ?? null,
      };
    });
    await prisma.securityGroup.updateMany({ data: { lastSyncedAt: new Date() } });
    return json({ groups: groups.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    mapPveError(err);
  }
});

const createSchema = z.object({
  name: groupNameSchema,
  description: z.object({ zh: z.string().max(200), en: z.string().max(200).optional() }).nullish(),
  scope: z.enum(["ADMIN_ONLY", "SHARED"]).default("ADMIN_ONLY"),
  isProvisioningDefault: z.boolean().default(false),
});

/** Create the group in every AZ's PVE + the metadata row. */
export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_group");
  const { name, description, scope, isProvisioningDefault } = parsed.data;

  const { failures } = await onAllNodes(user.id, async (client) => {
    const existing = await client.listGroups();
    if (!existing.some((g) => g.group === name)) {
      await client.createGroup(name, description?.zh);
    }
  });

  if (isProvisioningDefault) {
    await prisma.securityGroup.updateMany({ data: { isProvisioningDefault: false } });
  }
  await prisma.securityGroup.upsert({
    where: { name },
    create: {
      name,
      description: (description ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      scope,
      isProvisioningDefault,
      createdById: user.id,
      lastSyncedAt: new Date(),
    },
    update: {
      description: (description ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      scope,
      isProvisioningDefault,
    },
  });
  await audit({
    actorId: user.id,
    action: "firewall.sg.create",
    targetType: "SecurityGroup",
    targetId: name,
    metadata: { scope, isProvisioningDefault, failures },
  });
  return json({ ok: true, failures }, 201);
});
