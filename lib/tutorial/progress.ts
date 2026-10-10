/**
 * Tutorial progress and onboarding choice, saved in this browser only.
 * Nothing here is tied to an account, so it can't affect anyone else.
 */

import { STEPS } from "./steps";

// Bump the version when the steps change, so old progress is ignored.
const PROGRESS_KEY = "senzi-tutorial-v1";
const ONBOARDING_KEY = "senzi-onboarding-v1";

export interface TutorialProgress {
  step: number;
  completed: boolean;
}

export type OnboardingChoice = "explore" | "vc" | "dismissed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: progress just isn't remembered.
  }
}

export function loadProgress(): TutorialProgress | null {
  const raw = read(PROGRESS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TutorialProgress>;
    if (typeof value.step !== "number" || typeof value.completed !== "boolean") return null;
    if (value.step >= STEPS.length) return null;
    return { step: Math.max(0, Math.floor(value.step)), completed: value.completed };
  } catch {
    return null;
  }
}

export function saveProgress(progress: TutorialProgress | null) {
  write(PROGRESS_KEY, progress ? JSON.stringify(progress) : null);
}

export function loadOnboarding(): OnboardingChoice | null {
  const raw = read(ONBOARDING_KEY);
  return raw === "explore" || raw === "vc" || raw === "dismissed" ? raw : null;
}

export function saveOnboarding(choice: OnboardingChoice) {
  write(ONBOARDING_KEY, choice);
}
