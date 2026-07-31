import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { firstClient, groupNameSchema, onAllNodes } from "@/lib/firewall-admin";
import { mapPveError } from "@/lib/vm";
import type { PveFirewallRule } from "@/lib/pve";

type Ctx = { params: Promise<{ name: string }> };

const copySchema = z.object({
  name: groupNameSchema,
  description: z.object({ zh: z.string().max(200), en: z.string().max(200).optional() }).nullish(),
  scope: z.enum(["ADMIN_ONLY", "SHARED"]).default("ADMIN_ONLY"),
  isProvisioningDefault: z.boolean().default(false),
});

/** Keep only the fields this app manages so the clone matches admin-created rules. */
function ruleInput(rule: PveFirewallRule) {
  return {
    type: rule.type,
    action: rule.action,
    enable: rule.enable,
    proto: rule.proto,
    dport: rule.dport,
    sport: rule.sport,
    source: rule.source,
    dest: rule.dest,
    macro: rule.macro,
    comment: rule.comment,
  };
}

/** Clone a security group (rules + metadata) into every verified node's PVE. */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name: source } = await ctx.params;
  if (!groupNameSchema.safeParse(source).success) throw badRequest();

  const parsed = copySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_group");
  const { name: target, description, scope, isProvisioningDefault } = parsed.data;
  if (target === source) throw badRequest("copy_same_name");
  if (await prisma.securityGroup.findUnique({ where: { name: target } })) {
    throw badRequest("group_exists");
  }

  let copiedRules = 0;
  try {
    const first = await firstClient(user.id);
    const sourceComment = (await first.listGroups()).find((g) => g.group === source)?.comment;
    const sourceRules = (await first.listGroupRules(source)).sort((a, b) => a.pos - b.pos);
    copiedRules = sourceRules.length;

    const { failures } = await onAllNodes(user.id, async (client) => {
      const existing = await client.listGroups();
      if (!existing.some((g) => g.group === target)) {
        await client.createGroup(target, sourceComment);
      }
      for (const rule of sourceRules) {
        await client.addGroupRule(target, ruleInput(rule));
      }
    });

    if (isProvisioningDefault) {
      await prisma.securityGroup.updateMany({ data: { isProvisioningDefault: false } });
    }
    await prisma.securityGroup.upsert({
      where: { name: target },
      create: {
        name: target,
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
      action: "firewall.sg.copy",
      targetType: "SecurityGroup",
      targetId: target,
      metadata: { from: source, rules: copiedRules, scope, isProvisioningDefault, failures },
    });
    return json({ ok: failures.length === 0, failures, rules: copiedRules }, failures.length ? 207 : 201);
  } catch (err) {
    mapPveError(err);
  }
});
