import { NextRequest } from "next/server";
import { api, badRequest, json, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getUserQuota } from "@/lib/quota";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { mapPveError, vmContext } from "@/lib/vm";
import {
  assertBaseline,
  isBaselineRule,
  toPveRule,
  userRuleSchema,
  type BaselineRule,
} from "@/lib/firewall";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET: the VM's firewall state for the owner UI —
 * rules annotated as baseline (locked) / group attachment / user rule,
 * plus attachable SHARED security groups. Baseline drift is re-asserted here.
 */
export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client } = await vmContext(id);
  try {
    const baselineRow = await prisma.vmFirewallBaseline.findUnique({
      where: { bindingId: binding.id },
    });
    const baseline = (baselineRow?.rules as BaselineRule[] | null) ?? [];
    const repaired = await assertBaseline(client, binding.vmid, baseline);
    if (repaired) {
      await audit({
        actorId: null,
        action: "firewall.baseline.reasserted",
        targetType: "ResourceBinding",
        targetId: binding.id,
        metadata: { vmid: binding.vmid },
      });
    }

    const [rules, options, sharedGroups] = await Promise.all([
      client.listVmRules(binding.vmid),
      client.getVmFirewallOptions(binding.vmid).catch(() => ({ enable: 0 })),
      prisma.securityGroup.findMany({
        where: { scope: "SHARED" },
        select: { name: true, description: true },
      }),
    ]);

    const attachedGroups = rules.filter((r) => r.type === "group").map((r) => r.action);
    return json({
      enabled: options.enable === 1,
      rules: rules
        .filter((r) => r.type !== "group")
        .map((r) => ({
          pos: r.pos,
          direction: r.type,
          action: r.action,
          proto: r.proto ?? null,
          dport: r.dport ?? null,
          sport: r.sport ?? null,
          source: r.source ?? null,
          dest: r.dest ?? null,
          comment: isBaselineRule(r)
            ? (r.comment ?? "").replace(/mc:baseline\s*/, "")
            : (r.comment ?? null),
          enabled: r.enable === 1,
          locked: isBaselineRule(r),
        })),
      attachedGroups,
      availableGroups: sharedGroups,
    });
  } catch (err) {
    mapPveError(err);
  }
});

/** POST: add a rule (strict validation + per-user rule quota). */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId } = await vmContext(id, { write: true });
  rateLimit("firewall", userId, LIMITS.firewall.max, LIMITS.firewall.windowMs);

  const parsed = userRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "invalid_rule");

  try {
    const rules = await client.listVmRules(binding.vmid);
    const quota = await getUserQuota(binding.ticket.userId);
    const userRules = rules.filter((r) => r.type !== "group" && !isBaselineRule(r));
    if (userRules.length >= quota.maxFirewallRules) {
      throw new ApiError(422, "rule_limit", String(quota.maxFirewallRules));
    }
    await client.addVmRule(binding.vmid, toPveRule(parsed.data));
    await audit({
      actorId: userId,
      action: "firewall.rule.create",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid, after: parsed.data },
    });
    return json({ ok: true }, 201);
  } catch (err) {
    mapPveError(err);
  }
});
