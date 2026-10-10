"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { storeOnboarding, useOnboardingChoice, useTutorialProgress } from "@/components/tutorial/useTutorialProgress";

const chip =
  "inline-flex min-h-9 items-center rounded-full border border-hairline bg-surface px-3.5 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-900";

/**
 * A light first-visit choice, then shortcuts for returning visitors.
 * Saved in this browser only. Fixed height so nothing jumps when it appears.
 */
export function StartHere() {
  const router = useRouter();
  const choice = useOnboardingChoice();
  const progress = useTutorialProgress();

  // Old links to the homepage tutorial now go to the tutorial page.
  useEffect(() => {
    if (window.location.hash === "#tutorial") router.replace("/how-it-works");
  }, [router]);

  if (choice === undefined) return <div className="h-10" aria-hidden />;

  const returning = choice !== null || progress !== null;
  if (!returning) {
    return (
      <div className="flex min-h-10 flex-wrap items-center justify-center gap-2 text-sm text-ink-600">
        <span>New here? I&apos;m</span>
        <Link href="/markets" className={chip} onClick={() => storeOnboarding("explore")}>
          exploring forecasts
        </Link>
        <Link href="/vc" className={chip} onClick={() => storeOnboarding("vc")}>
          here for VC research
        </Link>
        <button
          type="button"
          onClick={() => storeOnboarding("dismissed")}
          className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  const inProgress = progress && !progress.completed && progress.step > 0;
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-center gap-2 text-sm text-ink-600">
      <span>Welcome back:</span>
      {inProgress ? (
        <Link href="/how-it-works" className={chip}>
          Continue tutorial (step {progress.step + 1})
        </Link>
      ) : progress?.completed ? (
        <Link href="/how-it-works" className={chip}>
          Replay tutorial
        </Link>
      ) : null}
      <Link href="/how-it-works#practice" className={chip}>
        Practice mode
      </Link>
      {choice === "vc" && (
        <Link href="/vc" className={chip}>
          VC Intelligence
        </Link>
      )}
    </div>
  );
}
