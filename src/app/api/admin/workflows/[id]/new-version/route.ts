import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { newWorkflowVersion } from "@/lib/workflow-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const result = await newWorkflowVersion(id, actor.id).catch(() => null);
  if (!result) throw badRequest("draft_exists");
  await audit({ actorId: actor.id, action: "workflow.new_version", targetType: "WorkflowSchema", targetId: result.id });
  return json({ schema: result }, 201);
});
