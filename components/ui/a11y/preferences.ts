"use client";

import { useSyncExternalStore } from "react";
import {
  A11Y_STORAGE_KEY,
  BOOLEAN_ATTRIBUTES,
  DEFAULT_PREFS,
  sanitizePrefs,
  type A11yPrefs,
  type BooleanPref,
  type ChartMode,
} from "./keys";

/**
 * Accessibility preferences, kept in localStorage and mirrored onto <html> as
 * data attributes (data-dyslexia, data-text-size, ...). Global CSS and shared
 * components read those attributes, so no page needs its own logic.
 */

const listeners = new Set<() => void>();
let cached: { raw: string | null; prefs: A11yPrefs } | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(A11Y_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Stable snapshot for useSyncExternalStore: the same object until storage changes. */
function snapshot(): A11yPrefs {
  const raw = readRaw();
  if (cached && cached.raw === raw) return cached.prefs;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cached = { raw, prefs: sanitizePrefs(parsed) };
  return cached.prefs;
}

export function applyPrefs(prefs: A11yPrefs) {
  const root = document.documentElement;
  for (const [key, attribute] of Object.entries(BOOLEAN_ATTRIBUTES) as [BooleanPref, string][]) {
    root.toggleAttribute(attribute, prefs[key]);
  }
  if (prefs.textSize === "md") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", prefs.textSize);
  if (prefs.chart === "default") root.removeAttribute("data-chart");
  else root.setAttribute("data-chart", prefs.chart);
}

export function setPrefs(next: A11yPrefs) {
  try {
    localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode); the settings still apply for this page.
    cached = { raw: readRaw(), prefs: next };
  }
  applyPrefs(next);
  listeners.forEach((listener) => listener());
}

export function updatePrefs(patch: Partial<A11yPrefs>) {
  setPrefs({ ...snapshot(), ...patch });
}

export function resetPrefs() {
  setPrefs(DEFAULT_PREFS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the settings: follow along.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== A11Y_STORAGE_KEY) return;
    applyPrefs(snapshot());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current preferences. Defaults on the server and during hydration. */
export function usePrefs(): A11yPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PREFS);
}

/** Chart accessibility mode for shared chart styles. */
export function useChartMode(): ChartMode {
  return usePrefs().chart;
}

/** True when the visitor asked for less motion, in Senzi or in their OS. */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.hasAttribute("data-reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
