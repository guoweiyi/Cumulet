import { z } from "zod";
import { prisma } from "./prisma";
import { pveClient, type PveClient } from "./pve";
import { ApiError } from "./api";

/**
 * Admin firewall operations span BOTH AZ nodes (separate PVE hosts): cluster
 * objects (security groups, IPSets, aliases) are applied to every verified
 * node so a group attached to a VM in either AZ resolves identically.
 */

export async function verifiedClients(actorId: string): Promise<{ name: string; client: PveClient }[]> {
  const nodes = await prisma.pveNode.findMany({ where: { verified: true } });
  if (nodes.length === 0) throw new ApiError(409, "no_verified_nodes");
  return nodes.map((n) => ({ name: n.name, client: pveClient(n, actorId) }));
}

export async function firstClient(actorId: string): Promise<PveClient> {
  return (await verifiedClients(actorId))[0].client;
}

/** Apply an operation to every node; collect per-node failures instead of aborting. */
export async function onAllNodes(
  actorId: string,
  fn: (client: PveClient) => Promise<void>,
): Promise<{ failures: { node: string; error: string }[] }> {
  const clients = await verifiedClients(actorId);
  const failures: { node: string; error: string }[] = [];
  for (const { name, client } of clients) {
    try {
      await fn(client);
    } catch (err) {
      failures.push({ node: name, error: err instanceof Error ? err.message : "error" });
    }
  }
  return { failures };
}

export const groupNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/);

/** Admin rules may use macros, alias names and +ipset refs. */
export const adminRuleSchema = z.object({
  direction: z.enum(["in", "out"]),
  action: z.enum(["ACCEPT", "DROP", "REJECT"]),
  proto: z.string().regex(/^[a-z0-9]{0,16}$/).nullish(),
  dport: z.string().regex(/^[\d:,]{0,32}$/).nullish(),
  sport: z.string().regex(/^[\d:,]{0,32}$/).nullish(),
  source: z.string().regex(/^[+a-zA-Z0-9_.:/,-]{0,64}$/).nullish(),
  dest: z.string().regex(/^[+a-zA-Z0-9_.:/,-]{0,64}$/).nullish(),
  macro: z.string().regex(/^[A-Za-z0-9-]{0,32}$/).nullish(),
  comment: z.string().max(120).nullish(),
  enable: z.boolean().default(true),
  pos: z.number().int().min(0).optional(),
});

export type AdminRuleInput = z.infer<typeof adminRuleSchema>;

export function adminRuleToPve(rule: AdminRuleInput) {
  return {
    type: rule.direction,
    action: rule.action,
    enable: rule.enable ? 1 : 0,
    proto: rule.proto || undefined,
    dport: rule.dport || undefined,
    sport: rule.sport || undefined,
    source: rule.source || undefined,
    dest: rule.dest || undefined,
    macro: rule.macro || undefined,
    comment: rule.comment || undefined,
    pos: rule.pos,
  };
}
