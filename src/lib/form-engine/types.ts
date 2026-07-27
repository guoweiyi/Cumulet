import type { I18nText } from "@/i18n/config";

/**
 * Canonical, portable form definition. This is the single source of truth for
 * a form: self-contained JSON with no DB ids, timestamps, or instance refs, so
 * exporting and re-importing (here or on another instance) is lossless.
 *
 * Fields reference each other ONLY by `id`.
 */

export type FieldType = "text" | "dropdown" | "radio_card" | "stepper" | "slider" | "toggle";

export type FieldOption = { value: string; label: I18nText };

export type FieldProps = {
  options?: FieldOption[]; // dropdown / radio_card
  min?: number; // slider / stepper
  max?: number;
  step?: number;
  unit?: I18nText; // slider / stepper
  prefix?: string; // text affix
  suffix?: string; // text affix
};

export type Operator = "equals" | "notEquals" | "isTrue" | "isFalse" | "in";

export type Condition =
  | { field: string; operator: Operator; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] };

export type Field = {
  id: string;
  type: FieldType;
  label: I18nText;
  hint?: I18nText;
  required: boolean;
  defaultValue?: unknown;
  props?: FieldProps;
  visibleWhen?: Condition; // absent = always visible
};

export type FormMeta = {
  name: I18nText;
  description: I18nText;
  defaultLocale: string;
};

export type FormDefinition = {
  formatVersion: 1;
  meta: FormMeta;
  fields: Field[];
};

export type FormValues = Record<string, unknown>;

export const CURRENT_FORMAT_VERSION = 1 as const;

/** Field types that carry a selectable option set. */
export const OPTION_TYPES: FieldType[] = ["dropdown", "radio_card"];
/** Field types that carry a numeric range. */
export const RANGE_TYPES: FieldType[] = ["slider", "stepper"];
