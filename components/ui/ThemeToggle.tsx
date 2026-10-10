"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { setThemeMode, useThemeMode, type ThemeMode } from "./theme";

const options: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

/** Icon button in the navbar that opens a small Light / Dark / System menu. */
export function ThemeToggle() {
  const mode = useThemeMode();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.mode === mode) ?? options[2];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full p-2 text-mist-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <current.Icon className="size-5" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-40 origin-top-right animate-[pop-in_140ms_var(--ease-out-soft)] rounded-xl border border-ink-200 bg-surface p-1 text-ink-900 shadow-[var(--shadow-lift)]"
        >
          {options.map(({ mode: option, label, Icon }) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option}
              onClick={() => {
                setThemeMode(option);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-ink-100"
            >
              <Icon className="size-4 text-ink-500" aria-hidden />
              {label}
              {mode === option && <Check className="ml-auto size-4 text-red-500" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

