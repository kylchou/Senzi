"use client";

import { useSyncExternalStore } from "react";
import {
  loadOnboarding,
  loadProgress,
  saveOnboarding,
  saveProgress,
  type OnboardingChoice,
  type TutorialProgress,
} from "@/lib/tutorial/progress";

// Reads browser-saved tutorial progress without a hydration mismatch: the
// server and first client render see null, then the saved value.
const EVENT = "senzi-tutorial-progress";
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
};
const notify = () => window.dispatchEvent(new Event(EVENT));

let cachedRaw: string | null = null;
let cached: TutorialProgress | null = null;
function progressSnapshot() {
  const value = loadProgress();
  const raw = JSON.stringify(value);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = value;
  }
  return cached;
}

export function useTutorialProgress(): TutorialProgress | null {
  return useSyncExternalStore(subscribe, progressSnapshot, () => null);
}

export function useOnboardingChoice(): OnboardingChoice | null | undefined {
  // undefined on the server, so callers can render a neutral placeholder.
  return useSyncExternalStore(subscribe, loadOnboarding, () => undefined);
}

export function storeProgress(progress: TutorialProgress | null) {
  saveProgress(progress);
  notify();
}

export function storeOnboarding(choice: OnboardingChoice) {
  saveOnboarding(choice);
  notify();
}
