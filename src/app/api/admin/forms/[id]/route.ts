import { NextRequest } from "next/server";
import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { saveDraft } from "@/lib/form-service";
import type { FormDefinition } from "@/lib/form-engine";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const schema = await prisma.formSchema.findUnique({ where: { id } });
  if (!schema) throw notFound();
  return json({
    schema: {
      id: schema.id,
      version: schema.version,
      status: schema.status,
      definition: schema.definition as unknown as FormDefinition,
    },
  });
});

/** Save a draft: full definition replaced atomically after validation. */
export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  const result = await saveDraft(id, body?.definition, "zh");
  if (!result.ok) {
    return json({ error: { code: "invalid_definition", issues: result.errors } }, 422);
  }
  await audit({ actorId: user.id, action: "form.update", targetType: "FormSchema", targetId: id });
  return json({ ok: true });
});

/** Delete — drafts with no submissions only. */
export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const schema = await prisma.formSchema.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  });
  if (!schema) throw notFound();
  if (schema.status !== "DRAFT" || schema._count.tickets > 0) throw badRequest("not_deletable");
  await prisma.formSchema.delete({ where: { id } });
  await audit({ actorId: user.id, action: "form.delete", targetType: "FormSchema", targetId: id });
  return json({ ok: true });
});
