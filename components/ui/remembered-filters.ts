"use client";

import { useSyncExternalStore } from "react";

/**
 * Remembers the last filters used on a listing page (for example
 * "status=OPEN&sort=active" for /markets) so navigation links return to them.
 */
const PREFIX = "senzi-filters:";
const listeners = new Set<() => void>();

export function saveFilters(path: string, query: string) {
  try {
    if (query) localStorage.setItem(PREFIX + path, query);
    else localStorage.removeItem(PREFIX + path);
  } catch {
    // Optional convenience; ignore storage errors.
  }
  listeners.forEach((listener) => listener());
}

export function clearFilters(path: string) {
  saveFilters(path, "");
}

function read(path: string): string {
  try {
    return localStorage.getItem(PREFIX + path) ?? "";
  } catch {
    return "";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The path with its remembered query, or just the path on the server and first render. */
export function useRememberedHref(path: string): string {
  const query = useSyncExternalStore(subscribe, () => read(path), () => "");
  return query ? `${path}?${query}` : path;
}

/** Query string from a GET form, without empty fields or the cursor. */
export function queryFromForm(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (typeof value === "string" && value.trim() && key !== "cursor") params.set(key, value.trim());
  }
  return params.toString();
}
