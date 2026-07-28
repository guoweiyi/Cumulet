import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { createWorkflow } from "@/lib/workflow-service";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";

export const GET = api(async () => {
  await requireAdmin();
  const [schemas, assignments] = await Promise.all([
    prisma.workflowSchema.findMany({
      orderBy: [{ familyKey: "asc" }, { version: "desc" }],
      include: { _count: { select: { bindings: true } } },
    }),
    prisma.resourceWorkflowBinding.findMany(),
  ]);
  const activeIds = new Set(assignments.map((assignment) => assignment.workflowSchemaId));
  return json({
    schemas: schemas.map((schema) => ({
      id: schema.id,
      familyKey: schema.familyKey,
      version: schema.version,
      status: schema.status,
      definition: parseWorkflowDefinition(schema.definition),
      bindingCount: schema._count.bindings,
      active: activeIds.has(schema.id),
      updatedAt: schema.updatedAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.object({ zh: z.string().trim().min(1).max(200), en: z.string().trim().max(200).optional() }),
  resourceType: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/),
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_workflow");
  const schema = await createWorkflow(parsed.data.name, parsed.data.resourceType, actor.id);
  await audit({ actorId: actor.id, action: "workflow.create", targetType: "WorkflowSchema", targetId: schema.id });
  return json({ schema }, 201);
});
