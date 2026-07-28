import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { publishWorkflow } from "@/lib/workflow-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  await publishWorkflow(id, actor.id);
  await audit({ actorId: actor.id, action: "workflow.publish", targetType: "WorkflowSchema", targetId: id });
  return json({ ok: true });
});
