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

function applyTheme(mode: ThemeMode, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    // Briefly transition colors so the switch feels smooth instead of instant.
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 300);
  }
  root.classList.toggle("dark", resolveDark(mode, media().matches));
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this page.
  }
  applyTheme(mode, true);
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
    const onChange = () => applyTheme("system", true);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  return mode;
}
