import { describe, expect, it } from "vitest";
import { LANGUAGES, LANGUAGE_SCRIPT, isLanguage, languageTag } from "@/lib/i18n/languages";
import { MESSAGES, PATTERNS } from "@/lib/i18n/messages";
import { GLOSSARY } from "@/lib/glossary";

const TARGETS = ["es", "zh", "hi", "pt", "fr", "ja", "ko"] as const;

describe("languages", () => {
  it("offers the eight languages with English first as the default", () => {
    expect(LANGUAGES.map((language) => language.code)).toEqual(["en", "es", "zh", "hi", "pt", "fr", "ja", "ko"]);
    expect(isLanguage("ko")).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(languageTag("zh")).toBe("zh-Hans");
  });

  it("pre-paint script sets the saved language but leaves English alone", () => {
    for (const [saved, expected] of [
      ["ja", "ja"],
      ["zh", "zh-Hans"],
      ["en", "en"],
      ["xx", "en"],
    ]) {
      const root = { lang: "en" };
      new Function("localStorage", "document", LANGUAGE_SCRIPT)({ getItem: () => saved }, { documentElement: root });
      expect(root.lang).toBe(expected);
    }
  });
});

describe("interface dictionary", () => {
  it("has a non-empty translation for every string in every language", () => {
    const english = Object.keys(MESSAGES.es);
    expect(english.length).toBeGreaterThan(200);
    for (const lang of TARGETS) {
      expect(Object.keys(MESSAGES[lang]).sort()).toEqual([...english].sort());
      for (const text of english) expect(MESSAGES[lang][text].trim().length, `${lang}: ${text}`).toBeGreaterThan(0);
    }
  });

  it("covers the accessibility panel and glossary", () => {
    for (const text of ["Accessibility", "Dyslexia-Friendly Reading", "Reset", "Focus Mode", "Larger Controls"]) {
      expect(MESSAGES.fr[text]).toBeDefined();
    }
    for (const entry of Object.values(GLOSSARY)) {
      expect(MESSAGES.hi[entry.body], entry.term).toBeDefined();
    }
  });

  it("translates dynamic labels with their numbers", () => {
    const apply = (lang: (typeof TARGETS)[number], text: string) => {
      const match = PATTERNS[lang].find(([pattern]) => pattern.test(text));
      return match ? text.replace(match[0], match[1]) : null;
    };
    expect(apply("es", "Closes in 12 days")).toBe("Cierra en 12 días");
    expect(apply("ja", "8 forecasts")).toBe("予測8件");
    expect(apply("ko", "1 open market")).toBe("진행 중인 마켓 1개");
    expect(apply("fr", "+14 pts since start")).toBe("+14 pts depuis le début");
    expect(apply("es", "Closes in a while")).toBeNull();
  });
});
