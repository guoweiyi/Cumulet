import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { randomToken } from "./crypto";
import {
  blankWorkflowDefinition,
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "./workflow-definition";
import type { I18nText } from "@/i18n/config";

function asJson(definition: WorkflowDefinition): Prisma.InputJsonValue {
  return definition as unknown as Prisma.InputJsonValue;
}

export async function createWorkflow(
  name: I18nText,
  resourceType: string,
  createdById: string,
): Promise<{ id: string }> {
  const definition = blankWorkflowDefinition(name, resourceType);
  const schema = await prisma.workflowSchema.create({
    data: {
      familyKey: `workflow_${randomToken(6)}`,
      version: 1,
      definition: asJson(definition),
      createdById,
    },
  });
  return { id: schema.id };
}

export async function saveWorkflowDraft(id: string, input: unknown): Promise<void> {
  const existing = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found");
  if (existing.status !== "DRAFT") throw new ApiError(400, "not_draft");
  const definition = parseWorkflowDefinition(input);
  if (!definition) throw new ApiError(422, "invalid_workflow_definition");
  await prisma.workflowSchema.update({ where: { id }, data: { definition: asJson(definition) } });
}

export async function publishWorkflow(id: string, actorId: string): Promise<void> {
  const schema = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!schema) throw new ApiError(404, "not_found");
  if (schema.status !== "DRAFT") throw new ApiError(400, "not_draft");
  const definition = parseWorkflowDefinition(schema.definition);
  if (!definition) throw new ApiError(400, "invalid_workflow_definition");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workflowSchema.updateMany({
      where: { familyKey: schema.familyKey, status: "PUBLISHED", id: { not: id } },
      data: { status: "ARCHIVED" },
    });
    await tx.workflowSchema.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: now },
    });
    await tx.resourceWorkflowBinding.upsert({
      where: { resourceType: definition.meta.resourceType },
      create: { resourceType: definition.meta.resourceType, workflowSchemaId: id, updatedById: actorId },
      update: { workflowSchemaId: id, updatedById: actorId },
    });
  });
}

export async function newWorkflowVersion(id: string, createdById: string): Promise<{ id: string }> {
  const source = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!source) throw new ApiError(404, "not_found");
  const existingDraft = await prisma.workflowSchema.findFirst({
    where: { familyKey: source.familyKey, status: "DRAFT" },
  });
  if (existingDraft) throw new ApiError(400, "draft_exists");
  const latest = await prisma.workflowSchema.aggregate({
    where: { familyKey: source.familyKey },
    _max: { version: true },
  });
  const draft = await prisma.workflowSchema.create({
    data: {
      familyKey: source.familyKey,
      version: (latest._max.version ?? source.version) + 1,
      definition: source.definition as Prisma.InputJsonValue,
      createdById,
    },
  });
  return { id: draft.id };
}

export async function assignedWorkflow(resourceType: string) {
  return prisma.resourceWorkflowBinding.findUnique({
    where: { resourceType },
    include: { workflowSchema: true },
  });
}
