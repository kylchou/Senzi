"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Accessibility,
  BookOpenText,
  Contrast,
  Focus,
  LineChart,
  MousePointerClick,
  RotateCcw,
  Rows3,
  Snail,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../cn";
import { isDefaultPrefs, PRESETS, samePrefs, type BooleanPref, type ChartMode, type TextSize } from "./keys";
import { resetPrefs, setPrefs, updatePrefs, usePrefs } from "./preferences";
import { Segmented } from "./Segmented";

const TEXT_SIZE_OPTIONS = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "XL", title: "Extra Large" },
] as const satisfies readonly {
  value: TextSize;
  label: string;
  title?: string;
}[];

const CHART_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "cvd", label: "Color-Blind", title: "Color-Blind Friendly" },
  { value: "contrast", label: "Contrast", title: "High Contrast" },
] as const satisfies readonly {
  value: ChartMode;
  label: string;
  title?: string;
}[];

const TOGGLES: { key: BooleanPref; label: string; Icon: LucideIcon }[] = [
  { key: "dyslexia", label: "Dyslexia-Friendly Reading", Icon: BookOpenText },
  { key: "spacing", label: "Comfortable Spacing", Icon: Rows3 },
  { key: "highContrast", label: "High Contrast", Icon: Contrast },
  { key: "reduceMotion", label: "Reduce Motion", Icon: Snail },
  { key: "focus", label: "Focus Mode", Icon: Focus },
  { key: "largeControls", label: "Larger Controls", Icon: MousePointerClick },
];

/**
 * Navbar button and floating Accessibility panel. Every change applies at once
 * (no Save) and persists. A small dot on the button shows when anything differs
 * from the defaults. On phones the panel is a bottom sheet.
 */
export function AccessibilityMenu() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = !isDefaultPrefs(prefs);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={active ? "Accessibility, settings active" : "Accessibility"}
        title="Accessibility"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          "relative grid size-9 place-items-center rounded-full text-ink-600 transition-[color,background-color] duration-150 hover:bg-ink-100 hover:text-ink-900",
          open && "bg-ink-100 text-ink-900",
        )}
      >
        <Accessibility className="size-[18px]" aria-hidden />
        {active && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 size-2 animate-[pop-in_200ms_var(--ease-out-soft)] rounded-full bg-red-500 ring-2 ring-page"
          />
        )}
      </button>

      {open &&
        // Portaled to <body> so the sheet sits above the mobile tab bar.
        createPortal(
          <>
            {/* Phones: dim the page behind the bottom sheet. */}
            <div
              aria-hidden
              className="fixed inset-0 z-[60] animate-[vt-fade_160ms_ease-out] bg-ink-950/30 sm:hidden"
            />
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-labelledby={titleId}
              className={cn(
                "fixed z-[61] flex flex-col overflow-hidden border border-hairline bg-surface text-ink-900 shadow-[var(--shadow-lift)]",
                "inset-x-0 bottom-0 max-h-[85dvh] animate-[sheet-up_260ms_var(--ease-out-soft)] rounded-t-3xl",
                "sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[4.5rem] sm:max-h-[calc(100dvh-6rem)] sm:w-[22rem] sm:origin-top-right sm:animate-[pop-in_160ms_var(--ease-out-soft)] sm:rounded-2xl",
              )}
            >
              <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink-200 sm:hidden" />
              <div className="flex items-center justify-between px-5 pb-2 pt-3 sm:pt-4">
                <h2 id={titleId} className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Accessibility
                </h2>
                <button
                  type="button"
                  onClick={() => close()}
                  aria-label="Close accessibility settings"
                  className="grid size-8 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <div role="group" aria-label="Presets" className="grid grid-cols-2 gap-1.5">
                  {PRESETS.map((preset, index) => {
                    const selected = samePrefs(prefs, preset.prefs);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-autofocus={index === 0 ? "" : undefined}
                        aria-pressed={selected}
                        onClick={() => setPrefs(preset.prefs)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-[color,background-color,border-color] duration-150",
                          selected
                            ? "border-ink-900 bg-ink-900 text-surface"
                            : "border-hairline text-ink-700 hover:border-ink-300 hover:text-ink-900",
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 space-y-4">
                  <Field Icon={Type} label="Text Size">
                    <Segmented
                      label="Text Size"
                      value={prefs.textSize}
                      options={TEXT_SIZE_OPTIONS}
                      onChange={(textSize) => updatePrefs({ textSize })}
                    />
                  </Field>
                  <Field Icon={LineChart} label="Chart Accessibility">
                    <Segmented
                      label="Chart Accessibility"
                      value={prefs.chart}
                      options={CHART_OPTIONS}
                      onChange={(chart) => updatePrefs({ chart })}
                    />
                  </Field>
                </div>

                <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {TOGGLES.map(({ key, label, Icon }) => (
                    <li key={key}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={prefs[key]}
                        onClick={() => updatePrefs({ [key]: !prefs[key] })}
                        className="flex w-full items-center gap-3 py-2.5 text-left text-sm font-medium text-ink-800 transition-colors hover:text-ink-900"
                      >
                        <Icon
                          className={cn("size-4 shrink-0", prefs[key] ? "text-red-500" : "text-ink-400")}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">{label}</span>
                        <Switch on={prefs[key]} />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={resetPrefs}
                    disabled={!active}
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-ink-600 transition-colors hover:text-ink-900 disabled:opacity-40"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Reset
                  </button>
                  <span className="text-[11px] text-ink-500">Saved on this device</span>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function Field({ Icon, label, children }: { Icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink-600">
        <Icon className="size-3.5 text-ink-400" aria-hidden />
        {label}
      </p>
      {children}
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        on ? "bg-ink-900" : "bg-ink-200",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
