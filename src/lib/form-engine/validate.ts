import type { FormDefinition, FormValues } from "./types";
import { evaluateVisibility } from "./visibility";

/**
 * Server-side (and client-side) submission validation. NEVER trusts
 * client-evaluated visibility: it recomputes the visible set from the stored
 * definition, strips every hidden field's value, and validates only visible
 * fields (required-when-visible, range/step, option membership, types).
 *
 * Error values are stable KEYS resolved by the UI under `formEngine.errors.*`.
 */
export type SubmissionResult = {
  ok: boolean;
  errors: Record<string, string>;
  /** Values with hidden fields dropped and types coerced — safe to snapshot. */
  cleaned: FormValues;
};

export function validateSubmission(def: FormDefinition, values: FormValues): SubmissionResult {
  const visible = evaluateVisibility(def, values);
  const errors: Record<string, string> = {};
  const cleaned: FormValues = {};

  for (const field of def.fields) {
    if (!visible.has(field.id)) continue; // hidden ⇒ excluded from payload & validation

    const v = values[field.id];
    const empty = v === undefined || v === null || v === "";
    if (empty) {
      if (field.required) errors[field.id] = "required";
      continue;
    }

    switch (field.type) {
      case "text": {
        if (typeof v !== "string" || v.length > 1000) errors[field.id] = "invalid";
        else cleaned[field.id] = v.trim();
        break;
      }
      case "dropdown":
      case "radio_card": {
        const opts = field.props?.options ?? [];
        if (typeof v !== "string" || !opts.some((o) => o.value === v)) errors[field.id] = "invalidOption";
        else cleaned[field.id] = v;
        break;
      }
      case "slider":
      case "stepper": {
        // Only numbers or numeric strings — reject booleans/objects that would
        // otherwise coerce (Number(true) === 1).
        if (typeof v !== "number" && typeof v !== "string") {
          errors[field.id] = "invalidNumber";
          break;
        }
        const n = typeof v === "number" ? v : Number(v);
        const min = field.props?.min ?? Number.MIN_SAFE_INTEGER;
        const max = field.props?.max ?? Number.MAX_SAFE_INTEGER;
        const step = field.props?.step ?? 1;
        const base = field.props?.min ?? 0;
        // step alignment tolerant of float noise
        const offset = (n - base) / step;
        const aligned = Math.abs(offset - Math.round(offset)) < 1e-9;
        if (!Number.isFinite(n) || n < min || n > max || !aligned) errors[field.id] = "invalidNumber";
        else cleaned[field.id] = n;
        break;
      }
      case "toggle": {
        if (typeof v !== "boolean") errors[field.id] = "invalid";
        else cleaned[field.id] = v;
        break;
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, cleaned };
}
