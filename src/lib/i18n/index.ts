import en, { type Messages } from "@/lib/i18n/en";
import ar from "@/lib/i18n/ar";

export type Locale = "en" | "ar";
export type MessageKey = keyof Messages;

export const LOCALES: readonly Locale[] = ["en", "ar"];
export const DEFAULT_LOCALE: Locale = "en";

const CATALOGUES: Record<Locale, Messages> = { en, ar };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

export function messages(locale: Locale): Messages {
  return CATALOGUES[locale];
}

export function t(locale: Locale, key: MessageKey): string {
  return CATALOGUES[locale][key];
}

/** NFR6: RTL layout is driven by this, not by per-screen overrides. */
export function dir(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
