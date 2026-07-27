import { z } from "zod";
import type { Condition, FormDefinition } from "./types";

/**
 * Zod schema for the canonical form-definition JSON. This validates the
 * STRUCTURE only (shapes, sizes, enums). Cross-field semantics — duplicate
 * ids, dangling condition references, circular chains, per-type prop
 * requirements — are checked in definition.ts.
 */

// Bilingual text: zh required, en optional (falls back to zh at render time).
const i18nText = z.object({
  zh: z.string().min(1).max(400),
  en: z.string().max(400).optional(),
});

// zh optional here (hints/units may be en-only in imports); still capped.
const i18nTextLoose = z.object({
  zh: z.string().max(400).optional(),
  en: z.string().max(400).optional(),
});

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "id must be a slug: letter then letters/digits/underscore");

// Condition is recursive (single | all | any). z.lazy handles the recursion.
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z
      .object({
        field: z.string().min(1).max(64),
        operator: z.enum(["equals", "notEquals", "isTrue", "isFalse", "in"]),
        value: z.unknown().optional(),
      })
      .strict(),
    z.object({ all: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(20) }).strict(),
  ]),
);

const propsSchema = z
  .object({
    options: z
      .array(z.object({ value: z.string().min(1).max(120), label: i18nText }).strict())
      .max(50)
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: i18nTextLoose.optional(),
    prefix: z.string().max(120).optional(),
    suffix: z.string().max(120).optional(),
  })
  .strict();

export const fieldSchema = z
  .object({
    id: idSchema,
    type: z.enum(["text", "dropdown", "radio_card", "stepper", "slider", "toggle"]),
    label: i18nText,
    hint: i18nTextLoose.optional(),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    props: propsSchema.optional(),
    visibleWhen: conditionSchema.optional(),
  })
  .strict();

export const formDefinitionSchema = z
  .object({
    formatVersion: z.literal(1),
    meta: z
      .object({
        name: i18nText,
        description: i18nTextLoose.optional().default({}),
        defaultLocale: z.enum(["zh", "en"]).default("zh"),
      })
      .strip(),
    fields: z.array(fieldSchema).min(1).max(100),
  })
  .strip();

export type ParsedDefinition = z.infer<typeof formDefinitionSchema>;

/** Structural parse only. Returns the Zod result; callers add semantic checks. */
export function parseDefinition(input: unknown) {
  return formDefinitionSchema.safeParse(input);
}

export type { FormDefinition };
