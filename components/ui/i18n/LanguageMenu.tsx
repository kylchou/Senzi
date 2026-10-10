"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, Languages } from "lucide-react";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { cn } from "../cn";
import { setLanguage, startTranslation, subscribeTranslation, translationState } from "./translator";

const SERVER_STATE = { lang: "en" as LanguageCode, machine: "idle" as const };

/** Navbar translate button with the eight interface languages. English is the default. */
export function LanguageMenu() {
  const { lang, machine } = useSyncExternalStore(subscribeTranslation, translationState, () => SERVER_STATE);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = LANGUAGES.find((language) => language.code === lang) ?? LANGUAGES[0];

  useEffect(() => startTranslation(), []);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + step + items.length) % items.length]?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Language: ${current.name}`}
        title="Language"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(
          "grid size-9 place-items-center rounded-full text-ink-600 transition-[color,background-color] duration-150 hover:bg-ink-100 hover:text-ink-900",
          open && "bg-ink-100 text-ink-900",
        )}
      >
        <Languages className="size-[18px]" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Language"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right animate-[pop-in_140ms_var(--ease-out-soft)] rounded-2xl border border-hairline bg-surface p-1.5 text-ink-900 shadow-[var(--shadow-lift)] max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:w-auto"
        >
          {LANGUAGES.map((language) => (
            <button
              key={language.code}
              type="button"
              role="menuitemradio"
              aria-checked={language.code === lang}
              lang={language.code === "zh" ? "zh-Hans" : language.code}
              onClick={() => {
                setLanguage(language.code);
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-ink-100 focus-visible:bg-ink-100"
            >
              <span translate="no" className="flex-1 font-medium">
                {language.native}
              </span>
              {language.code !== "en" && (
                <span translate="no" className="text-xs text-ink-500">
                  {language.name}
                </span>
              )}
              <Check className={cn("size-4 text-red-500", language.code !== lang && "invisible")} aria-hidden />
            </button>
          ))}
          {lang !== "en" && (machine === "unsupported" || machine === "downloading") && (
            <p className="mx-3 mb-1.5 mt-1 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-ink-500">
              {machine === "downloading"
                ? "Preparing translation for market content."
                : "Market content stays in English in this browser."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
