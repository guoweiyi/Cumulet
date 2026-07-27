import type { PveFirewallRule, PveRuleInput } from "./pve";

export type SyncMode = "merge" | "mirror";

export type RuleSyncOperation =
  | { kind: "add"; pos: number; rule: PveRuleInput }
  | { kind: "move"; from: number; to: number }
  | { kind: "update"; pos: number; rule: PveRuleInput }
  | { kind: "remove"; pos: number };

export function referencedFirewallObjects(
  rules: PveFirewallRule[],
  ipsetNames: Iterable<string>,
  aliasNames: Iterable<string>,
): { ipsets: Set<string>; aliases: Set<string> } {
  const knownIpsets = new Set(ipsetNames);
  const knownAliases = new Set(aliasNames);
  const ipsets = new Set<string>();
  const aliases = new Set<string>();

  for (const rule of rules) {
    for (const expression of [rule.source, rule.dest]) {
      if (!expression) continue;
      for (const rawToken of expression.split(/[\s,]+/)) {
        const token = rawToken.replace(/^!/, "");
        if (!token) continue;
        const isIpset = token.startsWith("+");
        const unscoped = token.replace(/^\+/, "").split("/").at(-1) ?? "";
        if (isIpset && knownIpsets.has(unscoped)) ipsets.add(unscoped);
        if (!isIpset && knownAliases.has(unscoped)) aliases.add(unscoped);
      }
    }
  }
  return { ipsets, aliases };
}

function normalizedRule(rule: PveFirewallRule | PveRuleInput): PveRuleInput {
  return {
    type: rule.type,
    action: rule.action,
    enable: rule.enable ?? 1,
    proto: rule.proto || undefined,
    dport: rule.dport || undefined,
    sport: rule.sport || undefined,
    source: rule.source || undefined,
    dest: rule.dest || undefined,
    macro: rule.macro || undefined,
    comment: rule.comment || undefined,
  };
}

function ruleIdentity(rule: PveFirewallRule | PveRuleInput): string {
  const r = normalizedRule(rule);
  return JSON.stringify([r.type, r.proto, r.dport, r.sport, r.source, r.dest, r.macro]);
}

function ruleValue(rule: PveFirewallRule | PveRuleInput): string {
  const r = normalizedRule(rule);
  return JSON.stringify([
    r.type,
    r.action,
    r.enable,
    r.proto,
    r.dport,
    r.sport,
    r.source,
    r.dest,
    r.macro,
    r.comment,
  ]);
}

/** Pure reconciliation plan used by the API and regression tests. */
export function planRuleSync(
  source: PveFirewallRule[],
  target: PveFirewallRule[],
  mode: SyncMode,
): RuleSyncOperation[] {
  const desiredRules = [...source].sort((a, b) => a.pos - b.pos);
  const working = [...target].sort((a, b) => a.pos - b.pos).map(normalizedRule);
  const operations: RuleSyncOperation[] = [];

  // Firewall order is security-sensitive. Build the source sequence from the
  // top down, moving an existing equivalent rule or inserting it at the exact
  // source position. Target-only merge rules remain after the source policy.
  for (let pos = 0; pos < desiredRules.length; pos += 1) {
    const desired = normalizedRule(desiredRules[pos]);
    const candidates = working
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule, index }) => index >= pos && ruleIdentity(rule) === ruleIdentity(desired));
    const match = candidates.find(({ rule }) => ruleValue(rule) === ruleValue(desired)) ?? candidates[0];

    if (!match) {
      operations.push({ kind: "add", pos, rule: desired });
      working.splice(pos, 0, desired);
      continue;
    }

    if (match.index !== pos) {
      operations.push({ kind: "move", from: match.index, to: pos });
      const [moved] = working.splice(match.index, 1);
      working.splice(pos, 0, moved);
    }
    if (ruleValue(working[pos]) !== ruleValue(desired)) {
      operations.push({ kind: "update", pos, rule: desired });
      working[pos] = desired;
    }
  }

  if (mode === "mirror") {
    for (let pos = working.length - 1; pos >= desiredRules.length; pos -= 1) {
      operations.push({ kind: "remove", pos });
    }
  }
  return operations;
}

export function sameText(a?: string, b?: string): boolean {
  return (a ?? "") === (b ?? "");
}
