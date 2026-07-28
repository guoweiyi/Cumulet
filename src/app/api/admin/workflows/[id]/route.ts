import { NextRequest } from "next/server";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { saveWorkflowDraft } from "@/lib/workflow-service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const schema = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!schema) throw notFound();
  return json({ schema });
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  await saveWorkflowDraft(id, body?.definition);
  await audit({ actorId: actor.id, action: "workflow.update", targetType: "WorkflowSchema", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const schema = await prisma.workflowSchema.findUnique({
    where: { id },
    include: { _count: { select: { bindings: true, resourceBindings: true } } },
  });
  if (!schema) throw notFound();
  if (schema.status !== "DRAFT" || schema._count.bindings || schema._count.resourceBindings) {
    throw badRequest("not_deletable");
  }
  await prisma.workflowSchema.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "workflow.delete", targetType: "WorkflowSchema", targetId: id });
  return json({ ok: true });
});
