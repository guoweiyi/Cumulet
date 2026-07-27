import { OPTION_TYPES, RANGE_TYPES, type Condition, type Field, type FormDefinition } from "./types";
import { parseDefinition } from "./schema";
import { referencedFields } from "./visibility";

/**
 * Full definition validation for save / import: Zod structure + cross-field
 * semantics (duplicate ids, dangling condition references, circular condition
 * chains, per-type prop requirements). Returns localized, human-readable
 * errors and NEVER a partially-valid definition.
 */

export type DefinitionError = { path?: string; message: string };
export type DefinitionResult =
  | { ok: true; definition: FormDefinition }
  | { ok: false; errors: DefinitionError[] };

type L = "zh" | "en";

// Engine-local message table (used server-side and in tests, outside React).
const MESSAGES: Record<string, Record<L, (p?: Record<string, string>) => string>> = {
  structure: { zh: () => "表单结构不合法", en: () => "Invalid form structure" },
  duplicateId: {
    zh: (p) => `字段 id 重复：${p?.id}`,
    en: (p) => `Duplicate field id: ${p?.id}`,
  },
  unknownRef: {
    zh: (p) => `字段「${p?.id}」的显示条件引用了不存在的字段：${p?.ref}`,
    en: (p) => `Field "${p?.id}" has a condition referencing an unknown field: ${p?.ref}`,
  },
  circular: {
    zh: (p) => `检测到循环的显示条件：${p?.chain}`,
    en: (p) => `Circular visibility condition detected: ${p?.chain}`,
  },
  optionsRequired: {
    zh: (p) => `「${p?.id}」为选项类字段，必须提供 options`,
    en: (p) => `"${p?.id}" is an option field and must define options`,
  },
  optionsForbidden: {
    zh: (p) => `「${p?.id}」不是选项类字段，不能包含 options`,
    en: (p) => `"${p?.id}" is not an option field and must not define options`,
  },
  rangeInvalid: {
    zh: (p) => `「${p?.id}」的取值范围不合法（min 必须小于 max）`,
    en: (p) => `"${p?.id}" has an invalid range (min must be less than max)`,
  },
  defaultOutOfRange: {
    zh: (p) => `「${p?.id}」的默认值超出 min/max 范围`,
    en: (p) => `"${p?.id}" default value is outside its min/max range`,
  },
  defaultNotOption: {
    zh: (p) => `「${p?.id}」的默认值不在 options 之中`,
    en: (p) => `"${p?.id}" default value is not one of its options`,
  },
};

function msg(locale: string, key: keyof typeof MESSAGES, params?: Record<string, string>): string {
  const l: L = locale === "en" ? "en" : "zh";
  return MESSAGES[key][l](params);
}

/** Detect a cycle in the field→referencedFields graph via DFS; report the chain. */
function findCycle(fields: Field[]): string[] | null {
  const edges = new Map<string, string[]>();
  for (const f of fields) {
    edges.set(f.id, f.visibleWhen ? referencedFields(f.visibleWhen) : []);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(fields.map((f) => [f.id, WHITE]));
  const stack: string[] = [];

  function dfs(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!color.has(next)) continue; // unknown ref handled separately
      if (color.get(next) === GRAY) {
        const from = stack.indexOf(next);
        return [...stack.slice(from), next];
      }
      if (color.get(next) === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const f of fields) {
    if (color.get(f.id) === WHITE) {
      const cyc = dfs(f.id);
      if (cyc) return cyc;
    }
  }
  return null;
}

// Bound condition nesting BEFORE Zod recurses (z.lazy), so a maliciously
// deep import can't blow the stack. Iterative BFS with a node budget.
const MAX_CONDITION_DEPTH = 8;
const MAX_CONDITION_NODES = 5000;

function conditionNestingOk(input: unknown): boolean {
  const obj = input as { fields?: unknown };
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.fields)) return true; // Zod will reject shape
  const queue: Array<{ node: unknown; depth: number }> = [];
  for (const f of obj.fields as unknown[]) {
    const vw = (f as { visibleWhen?: unknown })?.visibleWhen;
    if (vw != null) queue.push({ node: vw, depth: 1 });
  }
  let visited = 0;
  while (queue.length) {
    const { node, depth } = queue.shift()!;
    if (++visited > MAX_CONDITION_NODES || depth > MAX_CONDITION_DEPTH) return false;
    if (node && typeof node === "object") {
      const n = node as { all?: unknown; any?: unknown };
      const arr = Array.isArray(n.all) ? n.all : Array.isArray(n.any) ? n.any : null;
      if (arr) for (const child of arr) queue.push({ node: child, depth: depth + 1 });
    }
  }
  return true;
}

export function validateDefinition(input: unknown, locale = "zh"): DefinitionResult {
  if (!conditionNestingOk(input)) {
    return { ok: false, errors: [{ message: msg(locale, "structure") }] };
  }
  const parsed = parseDefinition(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i: { path: PropertyKey[]; message: string }) => {
      const path = i.path.map(String).join(".");
      return { path, message: `${msg(locale, "structure")}: ${path} — ${i.message}` };
    });
    return { ok: false, errors: errors.length ? errors : [{ message: msg(locale, "structure") }] };
  }
  const def = parsed.data as unknown as FormDefinition;
  const errors: DefinitionError[] = [];

  // Duplicate ids.
  const seen = new Set<string>();
  for (const f of def.fields) {
    if (seen.has(f.id)) errors.push({ path: f.id, message: msg(locale, "duplicateId", { id: f.id }) });
    seen.add(f.id);
  }

  // Condition references must point to existing fields.
  for (const f of def.fields) {
    if (!f.visibleWhen) continue;
    for (const ref of dedupe(referencedFields(f.visibleWhen))) {
      if (!seen.has(ref)) {
        errors.push({ path: f.id, message: msg(locale, "unknownRef", { id: f.id, ref }) });
      }
    }
  }

  // Per-type prop requirements + default sanity.
  for (const f of def.fields) {
    const isOption = OPTION_TYPES.includes(f.type);
    const isRange = RANGE_TYPES.includes(f.type);
    const opts = f.props?.options;
    if (isOption && (!opts || opts.length === 0)) {
      errors.push({ path: f.id, message: msg(locale, "optionsRequired", { id: f.id }) });
    }
    if (!isOption && opts && opts.length > 0) {
      errors.push({ path: f.id, message: msg(locale, "optionsForbidden", { id: f.id }) });
    }
    if (isRange && f.props?.min !== undefined && f.props?.max !== undefined && f.props.min >= f.props.max) {
      errors.push({ path: f.id, message: msg(locale, "rangeInvalid", { id: f.id }) });
    }
    if (isRange && typeof f.defaultValue === "number") {
      const { min, max } = f.props ?? {};
      if ((min !== undefined && f.defaultValue < min) || (max !== undefined && f.defaultValue > max)) {
        errors.push({ path: f.id, message: msg(locale, "defaultOutOfRange", { id: f.id }) });
      }
    }
    if (isOption && typeof f.defaultValue === "string" && opts && !opts.some((o: { value: string }) => o.value === f.defaultValue)) {
      errors.push({ path: f.id, message: msg(locale, "defaultNotOption", { id: f.id }) });
    }
  }

  // Circular condition chains (only meaningful if refs resolve).
  if (errors.length === 0) {
    const cycle = findCycle(def.fields);
    if (cycle) errors.push({ message: msg(locale, "circular", { chain: cycle.join(" → ") }) });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, definition: def };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Convenience for callers that already trust the JSON (e.g. reading DB rows). */
export function asDefinition(value: unknown): FormDefinition {
  return value as FormDefinition;
}

export type { Condition };
