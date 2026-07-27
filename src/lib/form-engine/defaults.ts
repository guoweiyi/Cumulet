import type { FormDefinition, FormValues } from "./types";

/** Seed initial values from field defaults / sensible per-type fallbacks. */
export function defaultValues(def: FormDefinition): FormValues {
  const out: FormValues = {};
  for (const f of def.fields) {
    if (f.defaultValue !== undefined && f.defaultValue !== null) {
      out[f.id] = f.defaultValue;
    } else if (f.type === "toggle") {
      out[f.id] = false;
    } else if (f.type === "slider" || f.type === "stepper") {
      out[f.id] = f.props?.min ?? 0;
    }
  }
  return out;
}
