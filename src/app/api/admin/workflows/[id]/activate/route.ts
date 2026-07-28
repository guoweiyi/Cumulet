import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const schema = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!schema) throw notFound();
  const definition = parseWorkflowDefinition(schema.definition);
  if (schema.status !== "PUBLISHED" || !definition) throw badRequest("workflow_not_published");
  await prisma.resourceWorkflowBinding.upsert({
    where: { resourceType: definition.meta.resourceType },
    create: { resourceType: definition.meta.resourceType, workflowSchemaId: id, updatedById: actor.id },
    update: { workflowSchemaId: id, updatedById: actor.id },
  });
  await audit({ actorId: actor.id, action: "workflow.activate", targetType: "WorkflowSchema", targetId: id });
  return json({ ok: true });
});
