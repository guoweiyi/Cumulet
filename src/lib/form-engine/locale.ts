import { localized, type I18nText } from "@/i18n/config";

/**
 * Localization helper with en→zh fallback. Re-exports the app-wide `localized`
 * so the engine, builder and renderer all resolve bilingual text identically.
 */
export function pick(text: I18nText | undefined | null, locale: string): string {
  return localized(text, locale);
}

export type { I18nText };
