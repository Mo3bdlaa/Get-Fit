import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en";
import ar from "@/lib/i18n/ar";
import { LOCALES, dir, isLocale, messages, t } from "@/lib/i18n";

describe("bilingual scaffolding (NFR6)", () => {
  it("translates every English key into Arabic", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty or untranslated Arabic string", () => {
    for (const [key, value] of Object.entries(ar)) {
      expect(value.trim(), `ar.${key} is empty`).not.toBe("");
      expect(value, `ar.${key} is still the English string`).not.toBe(
        en[key as keyof typeof en],
      );
    }
  });

  it("drives RTL from the locale, not from the screen", () => {
    expect(dir("ar")).toBe("rtl");
    expect(dir("en")).toBe("ltr");
  });

  it("exposes both locales and resolves each catalogue", () => {
    expect([...LOCALES]).toEqual(["en", "ar"]);
    expect(messages("ar")).toBe(ar);
    expect(t("ar", "navLog")).toBe(ar.navLog);
    expect(isLocale("fr")).toBe(false);
  });

  it("carries the not-medical-advice disclaimer in both languages (§8.3)", () => {
    expect(en.notMedicalAdvice.length).toBeGreaterThan(20);
    expect(ar.notMedicalAdvice.length).toBeGreaterThan(20);
  });
});
