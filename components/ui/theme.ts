"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./theme-key";

/**
 * Theme preference: "light", "dark", or "system" (follow the OS). Stored in
 * localStorage and applied as a `dark` class on <html>. The inline script in
 * ThemeScript applies it before first paint; this module keeps it in sync.
 */
export type ThemeMode = "light" | "dark" | "system";

export { THEME_STORAGE_KEY };

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

/**
 * Switches the dark class in a single frame. Measured alternatives were slower:
 * animating every element's colors froze large pages for most of a second, and
 * a full-page cross-fade (View Transitions) dropped several frames on slower
 * machines. One instant restyle is what feels smooth.
 *
 * Hover transitions (transition-colors and similar) are off during the swap, so
 * buttons, links, and cards do not each animate to their new colors and keep
 * restyling the page for the next few frames. They come back in idle time.
 */
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const dark = resolveDark(mode, media().matches);
  if (root.classList.contains("dark") === dark) return;
  root.classList.add("theme-swap");
  root.classList.toggle("dark", dark);
  const restore = () => root.classList.remove("theme-swap");
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(restore, { timeout: 500 });
  else window.setTimeout(restore, 100);
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this page.
  }
  applyTheme(mode);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Current preference. Renders "system" on the server and during hydration. */
export function useThemeMode(): ThemeMode {
  const mode = useSyncExternalStore(subscribe, readThemeMode, () => "system" as ThemeMode);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (mode !== "system") return;
    const query = media();
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  return mode;
}
