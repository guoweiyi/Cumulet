import { NextRequest } from "next/server";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import {
  adminRuleSchema,
  adminRuleToPve,
  groupNameSchema,
  onAllNodes,
} from "@/lib/firewall-admin";

type Ctx = { params: Promise<{ name: string; pos: string }> };

function parsePos(raw: string): number {
  const pos = Number(raw);
  if (!Number.isInteger(pos) || pos < 0) throw badRequest();
  return pos;
}

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name, pos: posRaw } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();
  const pos = parsePos(posRaw);

  const parsed = adminRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_rule");

  const { failures } = await onAllNodes(user.id, (client) =>
    client.updateGroupRule(name, pos, adminRuleToPve(parsed.data)),
  );
  await audit({
    actorId: user.id,
    action: "firewall.sg.rule.update",
    targetType: "SecurityGroup",
    targetId: name,
    metadata: { pos, after: parsed.data, failures },
  });
  return json({ ok: failures.length === 0, failures });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { name, pos: posRaw } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();
  const pos = parsePos(posRaw);

  const { failures } = await onAllNodes(user.id, (client) => client.deleteGroupRule(name, pos));
  await audit({
    actorId: user.id,
    action: "firewall.sg.rule.delete",
    targetType: "SecurityGroup",
    targetId: name,
    metadata: { pos, failures },
  });
  return json({ ok: failures.length === 0, failures });
});
