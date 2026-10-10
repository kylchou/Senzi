import { LANGUAGE_SCRIPT } from "@/lib/i18n/languages";
import { A11Y_SCRIPT } from "./a11y/keys";
import { THEME_STORAGE_KEY } from "./theme-key";

/**
 * Runs before first paint so saved preferences never flash: the dark theme,
 * accessibility settings (text size, contrast, motion, ...), and the page
 * language. On the client the type is text/plain so React does not re-run it.
 */
const script = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}${A11Y_SCRIPT}${LANGUAGE_SCRIPT}})()`;

export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
