import type { Condition, Field, FormDefinition, FormValues, Operator } from "./types";

/**
 * Nested conditional visibility — the semantics the spec calls out as the part
 * implementations get wrong. Rules:
 *
 *  1. Conditions may reference fields that are themselves conditional (chained
 *     nesting).
 *  2. If a referenced field is hidden, every field whose visibility depends on
 *     it is ALSO hidden (recursively). Dependency on a hidden field ⇒ hidden,
 *     regardless of that field's stored value.
 *  3. Hidden fields are excluded from required-validation and stripped from the
 *     payload (enforced in validate.ts, which consumes this module).
 *
 * A field is visible iff every field its condition references (transitively)
 * is visible AND the condition evaluates truthy against their values.
 */

function eq(a: unknown, b: unknown): boolean {
  if (typeof a === typeof b) return a === b;
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}

/** All field ids referenced anywhere in a condition tree. */
export function referencedFields(cond: Condition): string[] {
  if ("all" in cond) return cond.all.flatMap(referencedFields);
  if ("any" in cond) return cond.any.flatMap(referencedFields);
  return [cond.field];
}

function evalLeaf(operator: Operator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "equals":
      return eq(actual, expected);
    case "notEquals":
      return !eq(actual, expected);
    case "isTrue":
      return actual === true;
    case "isFalse":
      return actual === false;
    case "in":
      return Array.isArray(expected) && expected.some((v) => eq(actual, v));
    default:
      return false;
  }
}

export function evaluateVisibility(def: FormDefinition, values: FormValues): Set<string> {
  const byId = new Map<string, Field>(def.fields.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();

  function isVisible(id: string, visiting: Set<string>): boolean {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;

    const field = byId.get(id);
    if (!field) return false; // dangling ref — caught by validateDefinition
    if (!field.visibleWhen) {
      memo.set(id, true);
      return true;
    }
    // Cycle guard: a field transitively depending on itself is never visible
    // (validateDefinition rejects these at save/import time).
    if (visiting.has(id)) return false;
    visiting.add(id);

    // Rule 2: any referenced field being hidden hides this field.
    const refs = referencedFields(field.visibleWhen);
    let visible = refs.every((ref) => isVisible(ref, visiting));
    if (visible) visible = evalCondition(field.visibleWhen, values);

    visiting.delete(id);
    memo.set(id, visible);
    return visible;
  }

  function evalCondition(cond: Condition, vals: FormValues): boolean {
    if ("all" in cond) return cond.all.every((c) => evalCondition(c, vals));
    if ("any" in cond) return cond.any.some((c) => evalCondition(c, vals));
    return evalLeaf(cond.operator, vals[cond.field], cond.value);
  }

  const visible = new Set<string>();
  for (const f of def.fields) if (isVisible(f.id, new Set())) visible.add(f.id);
  return visible;
}
