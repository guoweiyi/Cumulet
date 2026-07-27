import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { randomToken } from "./crypto";
import { ApiError } from "./api";
import { validateDefinition, type FormDefinition } from "./form-engine";
import type { DefinitionError } from "./form-engine";

/**
 * Form persistence operations shared by the admin API routes and the seed
 * script — every create/import goes through the same `validateDefinition`
 * gate, so the built-in seed form proves the import format round-trips.
 */

export type SaveResult =
  | { ok: true; definition: FormDefinition }
  | { ok: false; errors: DefinitionError[] };

const json = (d: FormDefinition) => d as unknown as Prisma.InputJsonValue;

/** A minimal valid starter form for the "New form" action. */
export function blankDefinition(name: { zh: string; en?: string }): FormDefinition {
  return {
    formatVersion: 1,
    meta: { name, description: { zh: "" }, defaultLocale: "zh" },
    fields: [
      { id: "field_1", type: "text", label: { zh: "字段 1", en: "Field 1" }, required: true },
    ],
  };
}

/** Validate then persist a brand-new form family (version 1). */
export async function importDefinition(
  input: unknown,
  createdById: string,
  opts?: { locale?: string; publish?: boolean },
): Promise<{ ok: true; id: string } | { ok: false; errors: DefinitionError[] }> {
  const res = validateDefinition(input, opts?.locale ?? "zh");
  if (!res.ok) return { ok: false, errors: res.errors };
  const schema = await prisma.formSchema.create({
    data: {
      familyKey: `form_${randomToken(6)}`,
      version: 1,
      status: opts?.publish ? "PUBLISHED" : "DRAFT",
      publishedAt: opts?.publish ? new Date() : null,
      definition: json(res.definition),
      createdById,
    },
  });
  return { ok: true, id: schema.id };
}

/** Save edits to a DRAFT (validates first; never a partial save). */
export async function saveDraft(id: string, input: unknown, locale = "zh"): Promise<SaveResult> {
  const existing = await prisma.formSchema.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found");
  if (existing.status !== "DRAFT") throw new ApiError(400, "not_draft");
  const res = validateDefinition(input, locale);
  if (!res.ok) return res;
  await prisma.formSchema.update({ where: { id }, data: { definition: json(res.definition) } });
  return res;
}

/**
 * Publish a DRAFT. The spec requires exactly ONE active published form for the
 * request page, so this archives every other currently-published form (any
 * family), not just this family's previous version. That also guarantees a
 * ticket can only ever be submitted against the single live form.
 */
export async function publishForm(id: string): Promise<void> {
  const form = await prisma.formSchema.findUnique({ where: { id } });
  if (!form) throw new ApiError(404, "not_found");
  if (form.status !== "DRAFT") throw new ApiError(400, "not_draft");
  const res = validateDefinition(form.definition, "zh");
  if (!res.ok) throw new ApiError(400, "invalid_definition");
  await prisma.$transaction([
    prisma.formSchema.updateMany({
      where: { status: "PUBLISHED", id: { not: id } },
      data: { status: "ARCHIVED" },
    }),
    prisma.formSchema.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } }),
  ]);
}

/** Clone a version into a new editable DRAFT within the same family. */
export async function newVersion(id: string, createdById: string): Promise<{ id: string }> {
  const source = await prisma.formSchema.findUnique({ where: { id } });
  if (!source) throw new ApiError(404, "not_found");
  const existingDraft = await prisma.formSchema.findFirst({
    where: { familyKey: source.familyKey, status: "DRAFT" },
  });
  if (existingDraft) throw new ApiError(400, "draft_exists");
  const latest = await prisma.formSchema.aggregate({
    where: { familyKey: source.familyKey },
    _max: { version: true },
  });
  const draft = await prisma.formSchema.create({
    data: {
      familyKey: source.familyKey,
      version: (latest._max.version ?? source.version) + 1,
      status: "DRAFT",
      definition: source.definition as Prisma.InputJsonValue,
      createdById,
    },
  });
  return { id: draft.id };
}

/** Copy a form into a NEW family as a fresh draft (Duplicate action). */
export async function duplicateForm(id: string, createdById: string): Promise<{ id: string }> {
  const source = await prisma.formSchema.findUnique({ where: { id } });
  if (!source) throw new ApiError(404, "not_found");
  const def = source.definition as unknown as FormDefinition;
  const copy: FormDefinition = {
    ...def,
    meta: {
      ...def.meta,
      name: {
        zh: `${def.meta.name.zh}（副本）`,
        en: def.meta.name.en ? `${def.meta.name.en} (copy)` : undefined,
      },
    },
  };
  const schema = await prisma.formSchema.create({
    data: {
      familyKey: `form_${randomToken(6)}`,
      version: 1,
      status: "DRAFT",
      definition: json(copy),
      createdById,
    },
  });
  return { id: schema.id };
}
