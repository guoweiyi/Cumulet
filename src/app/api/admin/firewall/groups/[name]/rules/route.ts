import { NextRequest } from "next/server";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import {
  adminRuleSchema,
  adminRuleToPve,
  firstClient,
  groupNameSchema,
  onAllNodes,
} from "@/lib/firewall-admin";
import { mapPveError } from "@/lib/vm";

type Ctx = { params: Promise<{ name: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdmin();
  const { name } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();
  try {
    const client = await firstClient(user.id);
    const rules = await client.listGroupRules(name);
    return json({ rules });
  } catch (err) {
    mapPveError(err);
  }
});

/** Add a rule to the group on every AZ node. */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!groupNameSchema.safeParse(name).success) throw badRequest();

  const parsed = adminRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_rule");

  const { failures } = await onAllNodes(user.id, (client) =>
    client.addGroupRule(name, adminRuleToPve(parsed.data)),
  );
  await audit({
    actorId: user.id,
    action: "firewall.sg.rule.create",
    targetType: "SecurityGroup",
    targetId: name,
    metadata: { after: parsed.data, failures },
  });
  return json({ ok: failures.length === 0, failures }, failures.length ? 207 : 201);
});
