"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FlaskConical, Pencil, RotateCcw, X } from "lucide-react";
import { GetStarted } from "@/components/home/GetStarted";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ReadAloud } from "@/components/ui/a11y/ReadAloud";
import { yesPrice } from "@/lib/forecasting/lmsr";
import { cn } from "@/components/ui/cn";
import { initialState, stepDone, tutorialReducer } from "@/lib/tutorial/engine";
import { applyPracticeTrades } from "@/lib/tutorial/sandbox";
import { STEPS } from "@/lib/tutorial/steps";
import { DemoMarket } from "./DemoMarket";
import { storeProgress, useTutorialProgress } from "./useTutorialProgress";

/** Red that stays readable as small text in both themes. */
const RED_TEXT = "text-red-700";
const LAST = STEPS.length - 1;

/** The /how-it-works page: intro, guided walkthrough, completion, and practice mode. */
export function TutorialExperience() {
  const [state, dispatch] = useReducer(tutorialReducer, initialState);
  const saved = useTutorialProgress();
  const step = STEPS[state.step]!;

  // "#practice" (e.g. from the homepage) opens practice mode directly.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === "#practice") dispatch({ type: "practice" });
    };
    const timer = window.setTimeout(open, 0);
    window.addEventListener("hashchange", open);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", open);
    };
  }, []);

  // Remember progress so returning visitors can continue or replay.
  useEffect(() => {
    if (state.mode !== "guided") return;
    storeProgress({ step: state.step, completed: state.step === LAST || saved?.completed === true });
  }, [state.mode, state.step, saved?.completed]);

  // Esc leaves the guided walkthrough.
  useEffect(() => {
    if (state.mode !== "guided") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "exit" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode]);

  if (state.mode === "intro") {
    return <Intro saved={saved} onStart={(s) => dispatch({ type: "start", step: s })} onPractice={() => dispatch({ type: "practice" })} />;
  }

  if (state.mode === "sandbox") {
    return (
      <div className="space-y-4">
        <div className="surface-card flex flex-col gap-3 p-5 text-ink-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", RED_TEXT)}>Practice mode</p>
            <p className="mt-1 text-sm text-ink-600">
              Experiment freely. Nothing here touches your real credits, forecasts, or stats.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "resetPractice" })}>
              <RotateCcw className="size-4" aria-hidden /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "restart" })}>
              <Pencil className="size-4" aria-hidden /> Guided walkthrough
            </Button>
            <ButtonLink href="/markets" variant="accent" size="sm">
              Real markets <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
        <DemoMarket state={state} dispatch={dispatch} highlight={undefined} />
      </div>
    );
  }

  if (step.id === "done") {
    return <Completion onPractice={() => dispatch({ type: "practice" })} onRestart={() => dispatch({ type: "restart" })} onBack={() => dispatch({ type: "back" })} />;
  }

  return <Guided state={state} dispatch={dispatch} />;
}

function Intro({
  saved,
  onStart,
  onPractice,
}: {
  saved: ReturnType<typeof useTutorialProgress>;
  onStart: (step?: number) => void;
  onPractice: () => void;
}) {
  const inProgress = saved && !saved.completed && saved.step > 0 && saved.step < LAST;
  return (
    <div className="surface-card px-6 py-10 text-center text-ink-900 sm:px-12 sm:py-14">
      <Pencil className="mx-auto size-7 text-red-500" aria-hidden />
      <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Learn Senzi by doing it</h2>
      <p className="mx-auto mt-3 max-w-xl text-ink-600">
        Nine short steps with a made-up startup and 500 practice credits. Nothing touches your real account, and you can skip or leave any time.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {inProgress ? (
          <>
            <Button variant="accent" size="lg" onClick={() => onStart(saved.step)}>
              Continue from step {saved.step + 1} <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button variant="outline" size="lg" onClick={() => onStart(0)}>
              Start over
            </Button>
          </>
        ) : (
          <Button variant="accent" size="lg" onClick={() => onStart(0)}>
            {saved?.completed ? "Replay the walkthrough" : "Start the walkthrough"} <ArrowRight className="size-4" aria-hidden />
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={onPractice}>
          <FlaskConical className="size-4" aria-hidden /> Practice mode
        </Button>
      </div>
      {saved?.completed && <p className="mt-4 text-sm text-ink-500">You&apos;ve finished it before. Practice mode skips the popups.</p>}
    </div>
  );
}

function Guided({ state, dispatch }: { state: Parameters<typeof DemoMarket>[0]["state"]; dispatch: Parameters<typeof DemoMarket>[0]["dispatch"] }) {
  const step = STEPS[state.step]!;
  const done = stepDone(state);
  const wrapRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ top: number; arrow: number } | null>(null);
  const feedback = step.feedback?.({ ...state, price: yesPrice(applyPracticeTrades(state.trades)) }) ?? null;

  // Place the popup beside the highlighted part, kept inside the rail.
  const place = useCallback(() => {
    const rail = railRef.current;
    const pop = popRef.current;
    const target = step.target && wrapRef.current?.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`);
    if (!rail || !pop || !target) return;
    const railBox = rail.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const center = box.top - railBox.top + box.height / 2;
    const top = Math.max(0, Math.min(center - 48, railBox.height - pop.offsetHeight));
    setPos({ top, arrow: Math.max(20, Math.min(center - top, pop.offsetHeight - 20)) });
  }, [step.target]);

  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(place);
    if (wrapRef.current) observer.observe(wrapRef.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place, state]);

  // New step: focus the popup and bring the highlighted part into view.
  useEffect(() => {
    popRef.current?.focus({ preventScroll: true });
    const target = step.target && wrapRef.current?.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`);
    if (!target) return;
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    target.scrollIntoView({ behavior: "smooth", block: narrow ? "start" : "center" });
  }, [state.step, step.target]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight" && done) dispatch({ type: "next" });
    if (e.key === "ArrowLeft") dispatch({ type: "back" });
  };

  return (
    <div ref={wrapRef} className="grid gap-6 max-lg:pb-[46vh] lg:grid-cols-[minmax(0,1fr)_340px]">
      <DemoMarket state={state} dispatch={dispatch} highlight={step.target} />
      <div ref={railRef} className="relative">
        <div
          ref={popRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          style={pos ? { top: pos.top } : undefined}
          className={cn(
            "z-30 rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-ink-900 shadow-[var(--shadow-lift)] outline-none",
            "lg:absolute lg:inset-x-0 lg:transition-[top] lg:duration-300 lg:ease-out",
            "max-lg:fixed max-lg:inset-x-3 max-lg:bottom-3 max-lg:max-h-[42vh] max-lg:overflow-y-auto",
            "max-md:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.25rem)] max-md:max-h-[38vh]",
          )}
        >
          {pos && (
            <span
              aria-hidden
              className="absolute -left-2 hidden size-4 -translate-y-1/2 rotate-45 border-b border-l border-hairline bg-surface lg:block"
              style={{ top: pos.arrow }}
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", RED_TEXT)}>
              Step {state.step + 1} of {STEPS.length}
            </p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => dispatch({ type: "restart" })} className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Restart walkthrough" title="Restart">
                <RotateCcw className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={() => dispatch({ type: "exit" })} className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Exit walkthrough" title="Exit (Esc)">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Walkthrough progress"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={state.step + 1}
          >
            <div className="h-full rounded-full bg-red-500 transition-[width] duration-500" style={{ width: `${((state.step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <div className="mt-4 flex items-start justify-between gap-2">
            <h2 id={titleId} className="text-xl font-bold">
              {step.title}
            </h2>
            <ReadAloud key={step.id} targetId={[titleId, `${titleId}-body`]} label="this step" className="-mr-1.5" />
          </div>
          <div id={`${titleId}-body`}>
            <p className="mt-2 text-sm text-ink-600">{step.body}</p>
            {feedback && <p className="mt-2 text-sm font-medium text-ink-900">{feedback}</p>}
          </div>
          <p aria-live="polite" className="mt-3 min-h-5 text-sm">
            {step.todo && !done ? (
              <span className="text-amber-800 dark:text-amber-200">{step.todo}</span>
            ) : step.todo ? (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <Check className="size-4" aria-hidden /> Nice, that&apos;s it.
              </span>
            ) : null}
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "back" })} disabled={state.step === 0}>
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Button>
            <div className="flex items-center gap-2">
              {!done && (
                <button type="button" onClick={() => dispatch({ type: "skip" })} className="px-2 text-xs font-semibold text-ink-500 hover:text-ink-900">
                  Skip
                </button>
              )}
              <Button variant="accent" size="sm" onClick={() => dispatch({ type: "next" })} disabled={!done}>
                Next <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs text-ink-500">Practice only. Your real account isn&apos;t touched.</p>
        </div>
      </div>
    </div>
  );
}

function Completion({ onPractice, onRestart, onBack }: { onPractice: () => void; onRestart: () => void; onBack: () => void }) {
  const learned = [
    "Good questions are measurable, with a deadline and agreed sources",
    "The model baseline and the market probability are different numbers",
    "Credits buy shares, and a winning share pays 1 credit",
    "Outcomes are checked against the criteria by two admins",
  ];
  return (
    <div className="surface-card px-6 py-10 text-ink-900 sm:px-12 sm:py-14">
      <div className="mx-auto max-w-2xl text-center">
        <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", RED_TEXT)}>Step {STEPS.length} of {STEPS.length} · Complete</p>
        <h2 className="mt-3 text-3xl font-bold">You&apos;ve got it</h2>
        <ul className="mx-auto mt-6 max-w-lg space-y-2 text-left text-sm text-ink-600">
          {learned.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden /> {item}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/markets" variant="accent" size="lg">
            Explore real markets <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <Button variant="outline" size="lg" onClick={onPractice}>
            <FlaskConical className="size-4" aria-hidden /> Practice mode
          </Button>
          <GetStarted />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm text-ink-500">
          <button type="button" onClick={onBack} className="hover:text-ink-900">Back a step</button>
          <button type="button" onClick={onRestart} className="hover:text-ink-900">Restart</button>
          <Link href="/" className="hover:text-ink-900">Home</Link>
        </div>
      </div>
    </div>
  );
}
