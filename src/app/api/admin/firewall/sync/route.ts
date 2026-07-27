import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { pveClient } from "@/lib/pve";
import { groupNameSchema } from "@/lib/firewall-admin";
import { applyFirewallSnapshot, readFirewallSnapshot } from "@/lib/firewall-sync";

const bodySchema = z
  .object({
    sourceNodeId: z.string().min(1).max(64),
    targetNodeIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    mode: z.enum(["merge", "mirror"]).default("merge"),
    scope: z.enum(["all", "group"]).default("all"),
    groupName: groupNameSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.targetNodeIds.includes(body.sourceNodeId)) {
      ctx.addIssue({ code: "custom", path: ["targetNodeIds"], message: "source_is_target" });
    }
    if (new Set(body.targetNodeIds).size !== body.targetNodeIds.length) {
      ctx.addIssue({ code: "custom", path: ["targetNodeIds"], message: "duplicate_target" });
    }
    if (body.scope === "group" && !body.groupName) {
      ctx.addIssue({ code: "custom", path: ["groupName"], message: "group_required" });
    }
  });

/** Reconcile existing PVE firewall objects from one AZ into selected target AZs. */
export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_sync_request");
  const body = parsed.data;

  const [source, targets] = await Promise.all([
    prisma.pveNode.findFirst({ where: { id: body.sourceNodeId, verified: true } }),
    prisma.pveNode.findMany({
      where: { id: { in: body.targetNodeIds }, verified: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!source || targets.length !== body.targetNodeIds.length) throw badRequest("invalid_sync_nodes");

  const selectedGroup = body.scope === "group" ? body.groupName : undefined;
  const snapshot = await readFirewallSnapshot(pveClient(source, actor.id), selectedGroup);
  const results = [];
  // Two AZ records can point at the same PVE cluster. Sequential application
  // prevents concurrent updates from racing on firewall rule positions.
  for (const target of targets) {
    try {
      const changes = await applyFirewallSnapshot(
        pveClient(target, actor.id),
        snapshot,
        body.mode,
        selectedGroup,
      );
      results.push({ nodeId: target.id, node: target.name, ok: true as const, changes });
    } catch (error) {
      results.push({
        nodeId: target.id,
        node: target.name,
        ok: false as const,
        error: (error instanceof Error ? error.message : "sync_failed").slice(0, 500),
      });
    }
  }

  await audit({
    actorId: actor.id,
    action: "firewall.cross_zone.sync",
    targetType: "PveNode",
    targetId: source.id,
    metadata: {
      source: source.name,
      targets: results,
      mode: body.mode,
      scope: body.scope,
      groupName: selectedGroup,
    },
  });
  const hasFailures = results.some((result) => !result.ok);
  return json({ ok: !hasFailures, source: { id: source.id, name: source.name }, results }, hasFailures ? 207 : 200);
});
