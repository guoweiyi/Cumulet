import { z } from "zod";
import type { PveClient, PveFirewallRule, PveRuleInput } from "./pve";

/**
 * Firewall rule validation + baseline guardrails. PVE is the source of truth
 * for rules; this module validates user input strictly before it ever reaches
 * PVE and re-asserts admin baselines when drift is detected.
 */

export const BASELINE_MARK = "mc:baseline";

const PROTOCOLS = ["tcp", "udp", "icmp"] as const;

const cidrRe =
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d|[12]\d|3[012]))?$/;

export function isValidCidr(v: string): boolean {
  const m = v.match(cidrRe);
  if (!m) return false;
  return [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255);
}

/** "80", "80:443" (1-65535, start<=end) */
export function isValidPortRange(v: string): boolean {
  const m = v.match(/^(\d{1,5})(?::(\d{1,5}))?$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return a >= 1 && a <= 65535 && b >= 1 && b <= 65535 && a <= b;
}

export const userRuleSchema = z
  .object({
    direction: z.enum(["in", "out"]),
    action: z.enum(["ACCEPT", "DROP", "REJECT"]),
    proto: z.enum(PROTOCOLS).nullish(),
    dport: z.string().max(11).nullish(),
    sport: z.string().max(11).nullish(),
    source: z.string().max(43).nullish(),
    dest: z.string().max(43).nullish(),
    comment: z.string().max(120).nullish(),
    enable: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    for (const [field, v] of [
      ["dport", r.dport],
      ["sport", r.sport],
    ] as const) {
      if (v && !isValidPortRange(v)) {
        ctx.addIssue({ code: "custom", path: [field], message: "invalid_port" });
      }
    }
    for (const [field, v] of [
      ["source", r.source],
      ["dest", r.dest],
    ] as const) {
      if (v && !isValidCidr(v)) {
        ctx.addIssue({ code: "custom", path: [field], message: "invalid_cidr" });
      }
    }
    if ((r.dport || r.sport) && !r.proto) {
      ctx.addIssue({ code: "custom", path: ["proto"], message: "proto_required" });
    }
    if (r.comment && r.comment.includes(BASELINE_MARK)) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "reserved" });
    }
  });

export type UserRuleInput = z.infer<typeof userRuleSchema>;

export function toPveRule(rule: UserRuleInput): PveRuleInput {
  return {
    type: rule.direction,
    action: rule.action,
    enable: rule.enable ? 1 : 0,
    proto: rule.proto ?? undefined,
    dport: rule.dport || undefined,
    sport: rule.sport || undefined,
    source: rule.source || undefined,
    dest: rule.dest || undefined,
    comment: rule.comment || undefined,
  };
}

// ---------------------------------------------------------------------------
// Baseline guardrails
// ---------------------------------------------------------------------------

export type BaselineRule = {
  direction: "in" | "out";
  action: "ACCEPT" | "DROP" | "REJECT";
  proto?: string;
  dport?: string;
  source?: string;
  comment?: string;
};

export function isBaselineRule(rule: PveFirewallRule): boolean {
  return typeof rule.comment === "string" && rule.comment.includes(BASELINE_MARK);
}

function baselineSignature(r: BaselineRule): string {
  return [r.direction, r.action, r.proto ?? "", r.dport ?? "", r.source ?? ""].join("|");
}

function pveRuleSignature(r: PveFirewallRule): string {
  return [r.type, r.action, r.proto ?? "", r.dport ?? "", r.source ?? ""].join("|");
}

/**
 * Ensure every baseline rule exists (and is enabled) on the VM. Returns true
 * if drift was repaired. Deleted/tampered baselines are re-added at the top.
 */
export async function assertBaseline(
  client: PveClient,
  vmid: number,
  baseline: BaselineRule[],
): Promise<boolean> {
  if (baseline.length === 0) return false;
  const rules = await client.listVmRules(vmid);
  const present = new Map(
    rules.filter((r) => r.type !== "group").map((r) => [pveRuleSignature(r), r]),
  );
  let repaired = false;
  for (const b of baseline) {
    const match = present.get(baselineSignature(b));
    if (!match) {
      await client.addVmRule(vmid, {
        type: b.direction,
        action: b.action,
        proto: b.proto,
        dport: b.dport,
        source: b.source,
        enable: 1,
        comment: `${BASELINE_MARK} ${b.comment ?? ""}`.trim(),
        pos: 0,
      });
      repaired = true;
    } else if (match.enable !== 1 || !isBaselineRule(match)) {
      await client.updateVmRule(vmid, match.pos, {
        enable: 1,
        comment: `${BASELINE_MARK} ${b.comment ?? ""}`.trim(),
      });
      repaired = true;
    }
  }
  return repaired;
}
