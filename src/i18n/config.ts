export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh";
export const LOCALE_COOKIE = "MC_LOCALE";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Bilingual JSON value stored in DB: { zh: string, en?: string } — zh required, en falls back to zh. */
export type I18nText = { zh: string; en?: string };

export function localized(text: unknown, locale: string): string {
  if (!text || typeof text !== "object") return "";
  const t = text as I18nText;
  return (locale === "en" && t.en) || t.zh || "";
}
