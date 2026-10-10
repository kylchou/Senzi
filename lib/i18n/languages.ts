/** Interface languages. English is the source language and the default. */
export const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "zh", name: "Mandarin Chinese", native: "中文" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type TargetLanguage = Exclude<LanguageCode, "en">;

export const DEFAULT_LANGUAGE: LanguageCode = "en";
export const LANGUAGE_STORAGE_KEY = "senzi-lang";

export function isLanguage(value: unknown): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

/** BCP 47 tag for <html lang> and speech: Chinese is Simplified (zh-Hans). */
export function languageTag(code: LanguageCode): string {
  return code === "zh" ? "zh-Hans" : code;
}

/** Pre-paint source that sets <html lang> from the saved language. */
export const LANGUAGE_SCRIPT = `try{var l=localStorage.getItem("${LANGUAGE_STORAGE_KEY}");if(${JSON.stringify(
  LANGUAGES.map((language) => language.code),
)}.indexOf(l)>0)document.documentElement.lang=l==="zh"?"zh-Hans":l}catch(e){}`;
