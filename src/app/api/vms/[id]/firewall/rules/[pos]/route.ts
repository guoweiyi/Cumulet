import { NextRequest } from "next/server";
import { api, badRequest, forbidden, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { mapPveError, vmContext } from "@/lib/vm";
import { isBaselineRule, toPveRule, userRuleSchema } from "@/lib/firewall";

type Ctx = { params: Promise<{ id: string; pos: string }> };

async function loadRule(bindingId: string, posRaw: string) {
  const { binding, client, userId } = await vmContext(bindingId, { write: true });
  const pos = Number(posRaw);
  if (!Number.isInteger(pos) || pos < 0) throw badRequest();
  const rules = await client.listVmRules(binding.vmid);
  const rule = rules.find((r) => r.pos === pos);
  if (!rule || rule.type === "group") throw notFound();
  // Baseline rules are admin-managed: users may not edit or delete them.
  if (isBaselineRule(rule)) throw forbidden();
  return { binding, client, userId, pos, rule };
}

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id, pos: posRaw } = await ctx.params;
  const { binding, client, userId, pos, rule } = await loadRule(id, posRaw);
  rateLimit("firewall", userId, LIMITS.firewall.max, LIMITS.firewall.windowMs);

  const parsed = userRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "invalid_rule");

  try {
    await client.updateVmRule(binding.vmid, pos, toPveRule(parsed.data));
    await audit({
      actorId: userId,
      action: "firewall.rule.update",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid, before: rule, after: parsed.data },
    });
    return json({ ok: true });
  } catch (err) {
    mapPveError(err);
  }
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const { id, pos: posRaw } = await ctx.params;
  const { binding, client, userId, pos, rule } = await loadRule(id, posRaw);
  rateLimit("firewall", userId, LIMITS.firewall.max, LIMITS.firewall.windowMs);
  try {
    await client.deleteVmRule(binding.vmid, pos);
    await audit({
      actorId: userId,
      action: "firewall.rule.delete",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid, before: rule },
    });
    return json({ ok: true });
  } catch (err) {
    mapPveError(err);
  }
});
