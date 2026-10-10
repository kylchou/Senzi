"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  FastForward,
  FlaskConical,
  Lightbulb,
  PartyPopper,
  RotateCcw,
  X,
} from "lucide-react";
import { AllocationBar } from "@/components/ui/AllocationBar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ReadAloud } from "@/components/ui/a11y/ReadAloud";
import { cn } from "@/components/ui/cn";
import { formatShare } from "@/lib/market-view/format";
import {
  allocationShare,
  PRACTICE_BALANCE,
  previewForecast,
  TUTORIAL_MARKET,
  TUTORIAL_RESOLUTION,
  TUTORIAL_STARTUP,
  TUTORIAL_STEPS,
  validatePracticeCredits,
  type Side,
  type TutorialStep,
} from "@/lib/tutorial/sandbox";

/** Red that stays readable as small text on the guide panel in both themes. */
const RED_TEXT = "text-red-700";

/** Links to "#tutorial" (e.g. the navbar pencil) start the walkthrough. */
export const TUTORIAL_HASH = "#tutorial";

type Target = NonNullable<TutorialStep["target"]>;

interface Practice {
  startupOpened: boolean;
  rulesOpened: boolean;
  quizAnswer: "baseline" | "allocation" | "probability" | null;
  side: Side | null;
  probability: number | null;
  amount: string;
  amountTouched: boolean;
  submitted: { side: Side; credits: number } | null;
  resolved: boolean;
}

const initialPractice: Practice = {
  startupOpened: false,
  rulesOpened: false,
  quizAnswer: null,
  side: null,
  probability: null,
  amount: "",
  amountTouched: false,
  submitted: null,
  resolved: false,
};

const PRESETS = [25, 50, 100, 200];

export function HowItWorksTutorial() {
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [practice, setPractice] = useState<Practice>(initialPractice);
  const sectionRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Height of the pinned instructions, reserved below the practice market so its last steps can scroll clear of them.
  const [guideHeight, setGuideHeight] = useState(0);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setGuideHeight(Math.ceil(entry.borderBoxSize[0]?.blockSize ?? 0)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const titleId = useId();

  const step = TUTORIAL_STEPS[stepIndex]!;
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;
  const credits = Number(practice.amount);
  const amountError = validatePracticeCredits(practice.amount, PRACTICE_BALANCE);
  const complete = stepComplete(step.id, practice, amountError);
  const active: Target | null = started ? step.target : null;

  const start = useCallback(() => {
    setPractice(initialPractice);
    setStepIndex(0);
    setStarted(true);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const exit = useCallback(() => {
    setStarted(false);
    if (window.location.hash === TUTORIAL_HASH) history.replaceState(null, "", "#how-it-works");
  }, []);

  // Any link to #tutorial (the navbar pencil, hero button) starts the walkthrough.
  // Next.js links update the hash with pushState, which doesn't fire
  // "hashchange", so listen for the clicks too. Arriving from another page
  // with #tutorial in the URL is handled on mount.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === TUTORIAL_HASH) start();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      if (url.hash === TUTORIAL_HASH && url.pathname === window.location.pathname) start();
    };
    const timer = window.setTimeout(onHash, 0);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, [start]);

  // Escape leaves the walkthrough.
  useEffect(() => {
    if (!started) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, exit]);

  // Move focus to the instructions and bring the highlighted part into view.
  // Step 1 is skipped: start() already scrolls the whole walkthrough into view,
  // and a second smooth scroll would cancel it.
  useEffect(() => {
    if (!started) return;
    panelRef.current?.focus({ preventScroll: true });
    if (stepIndex === 0) return;
    const target = step.target && sectionRef.current?.querySelector(`[data-spot="${step.target}"]`);
    if (!(target instanceof HTMLElement)) return;
    // On small screens the guide is a bottom sheet, so keep the target near the top.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // On large screens the guide is pinned 16px from the top, so center the target in the space below it.
    const pinnedBottom = 16 + (panelRef.current?.offsetHeight ?? 0);
    const rect = target.getBoundingClientRect();
    const gap = Math.max(16, (window.innerHeight - pinnedBottom - rect.height) / 2);
    window.scrollTo({ top: window.scrollY + rect.top - pinnedBottom - gap, behavior: "smooth" });
  }, [started, step.target, stepIndex]);

  const update = (patch: Partial<Practice>) => setPractice((p) => ({ ...p, ...patch }));
  const next = () => setStepIndex((i) => Math.min(i + 1, TUTORIAL_STEPS.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  // Practice market state, including the user's own practice forecast.
  const yes = TUTORIAL_MARKET.yesCredits + (practice.submitted?.side === "YES" ? practice.submitted.credits : 0);
  const no = TUTORIAL_MARKET.noCredits + (practice.submitted?.side === "NO" ? practice.submitted.credits : 0);
  const share = allocationShare(yes, no);
  const preview =
    practice.side && !amountError
      ? previewForecast({ side: practice.side, credits, yesCredits: TUTORIAL_MARKET.yesCredits, noCredits: TUTORIAL_MARKET.noCredits })
      : null;
  const submittedPreview = practice.submitted
    ? previewForecast({ ...practice.submitted, yesCredits: TUTORIAL_MARKET.yesCredits, noCredits: TUTORIAL_MARKET.noCredits })
    : null;
  const won = practice.submitted?.side === TUTORIAL_RESOLUTION.outcome;
  const balance =
    PRACTICE_BALANCE -
    (practice.submitted?.credits ?? 0) +
    (practice.resolved && won && submittedPreview ? submittedPreview.payoutIfRight : 0);

  return (
    <div ref={sectionRef} id="tutorial" className={cn("scroll-mt-6", started && "max-lg:pb-[46vh]")}>
      <div
        className={cn("mx-auto flex max-w-3xl flex-col gap-4", started && "lg:pb-[var(--guide-height)]")}
        style={{ "--guide-height": `${guideHeight}px` } as React.CSSProperties}
      >
        {/* Guide: pinned above the practice market on large screens, a bottom sheet on small ones. */}
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-labelledby={titleId}
          className={cn(
            "surface-card p-5 text-ink-900 outline-none sm:p-6",
            started && "lg:sticky lg:top-4 lg:z-20 lg:shadow-[var(--shadow-lift)]",
            // On small screens the guide becomes a bottom sheet so it stays next to what you're tapping.
            started &&
              "max-lg:fixed max-lg:inset-x-3 max-lg:bottom-3 max-lg:z-30 max-lg:max-h-[42vh] max-lg:overflow-y-auto max-lg:p-5 max-md:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.25rem)] max-md:max-h-[38vh]",
          )}
        >
          {started ? (
            <>
              <div className="flex items-center gap-4">
                <p className={cn("shrink-0 text-xs font-semibold uppercase tracking-[0.14em] tabular-nums", RED_TEXT)}>
                  Step {stepIndex + 1} of {TUTORIAL_STEPS.length}
                </p>
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={TUTORIAL_STEPS.length}
                  aria-valuenow={stepIndex + 1}
                  aria-label="Walkthrough progress"
                >
                  <div className="h-full rounded-full bg-red-500 transition-all duration-500" style={{ width: `${((stepIndex + 1) / TUTORIAL_STEPS.length) * 100}%` }} />
                </div>
                <button type="button" onClick={exit} className="-mr-1.5 rounded-full p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Exit walkthrough">
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="mt-4 flex items-start justify-between gap-2">
                <h3 id={titleId} className="text-xl font-bold sm:text-2xl">
                  {isLast && <PartyPopper className="mr-2 inline size-6 text-red-500" aria-hidden />}
                  {step.title}
                </h3>
                <ReadAloud key={step.id} targetId={[titleId, `${titleId}-body`]} label="this step" className="-mr-1.5" />
              </div>
              <p id={`${titleId}-body`} className="mt-1.5 max-w-2xl text-ink-600">
                {step.body}
              </p>

              {step.id === "numbers" && <NumbersQuiz answer={practice.quizAnswer} onAnswer={(quizAnswer) => update({ quizAnswer })} />}

              <div aria-live="polite" className="mt-3 min-h-6 text-sm">
                <StepFeedback step={step} practice={practice} complete={complete} />
              </div>

              {isLast ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <ButtonLink href="/markets" variant="accent">
                    Explore real markets <ArrowRight className="size-4" aria-hidden />
                  </ButtonLink>
                  <Button variant="outline" onClick={start}>
                    <RotateCcw className="size-4" aria-hidden /> Restart
                  </Button>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <Button variant="outline" size="sm" onClick={back} disabled={stepIndex === 0}>
                    <ArrowLeft className="size-4" aria-hidden /> Back
                  </Button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={start} className="text-xs font-semibold text-ink-500 hover:text-ink-900">
                      Restart
                    </button>
                    <Button variant="accent" size="sm" onClick={next} disabled={!complete}>
                      Next <ArrowRight className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
              <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-500 lg:hidden">
                Practice mode: nothing here changes your real credits or places a real forecast.
              </p>
            </>
          ) : (
            <>
              <h3 id={titleId} className="text-xl font-bold sm:text-2xl">Learn by doing</h3>
              <ol className="mt-4 grid gap-3 text-sm text-ink-600 sm:grid-cols-3">
                {["Read a YES/NO question and how it resolves", "Pick a side and allocate practice credits", "Watch the market resolve and pay out"].map((t, i) => (
                  <li key={t} className="flex gap-3 sm:flex-col sm:gap-1">
                    <span className={cn("font-display font-extrabold tabular-nums", RED_TEXT)}>{String(i + 1).padStart(2, "0")}</span>
                    {t}
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
                <Button variant="accent" onClick={start}>
                  Start the walkthrough <ArrowRight className="size-4" aria-hidden />
                </Button>
                <p className="text-sm text-ink-500">{`Two minutes, a made-up startup, and ${PRACTICE_BALANCE} practice credits.`}</p>
              </div>
              <p className="mt-3 text-xs text-ink-500">
                Or skip ahead and <Link href="/markets" className="underline hover:text-ink-900">browse real markets</Link>.
              </p>
            </>
          )}
        </div>

        {/* Practice market. Before the walkthrough starts, a short fading preview. */}
        <div
          className={cn("relative", !started && "max-h-80 overflow-hidden [mask-image:linear-gradient(to_bottom,black_35%,transparent)]")}
        >
          <div
            className={cn(
              "relative rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-lift)] ring-1 ring-hairline transition sm:p-6",
              !started && "pointer-events-none select-none",
            )}
            aria-hidden={!started}
            inert={!started}
          >
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30">
                <FlaskConical className="size-3.5" aria-hidden /> Practice market · fictional
              </span>
              <span className="text-xs font-medium text-ink-600 tabular-nums">
                Practice balance <strong className="text-ink-900">{balance}</strong> credits
              </span>
            </div>

            <Spot id="startup" active={active} hint={step.hint}>
              <button
                type="button"
                onClick={() => update({ startupOpened: true })}
                className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-ink-50"
                aria-expanded={practice.startupOpened}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink-900 text-surface">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-semibold text-ink-900">{TUTORIAL_STARTUP.name}</span>
                  <span className="block text-sm text-ink-600">{TUTORIAL_STARTUP.tagline}</span>
                  {practice.startupOpened && (
                    <span className="mt-2 block animate-[tutorial-in_300ms_ease-out] text-sm text-ink-700">
                      {TUTORIAL_STARTUP.about}
                      <span className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-600">
                        {[TUTORIAL_STARTUP.industry, TUTORIAL_STARTUP.stage, TUTORIAL_STARTUP.headquarters].map((t) => (
                          <span key={t} className="rounded-full bg-ink-100 px-2 py-0.5">{t}</span>
                        ))}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            </Spot>

            <Spot id="question" active={active} hint={step.hint} className="mt-4">
              <div className="rounded-xl p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Closes {TUTORIAL_MARKET.deadline}</p>
                <h3 className="mt-1 text-lg font-bold leading-snug text-ink-900">{TUTORIAL_MARKET.question}</h3>
                <button
                  type="button"
                  onClick={() => update({ rulesOpened: !practice.rulesOpened })}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-700 hover:text-ink-900"
                  aria-expanded={practice.rulesOpened}
                >
                  How it resolves
                  <ChevronDown className={cn("size-4 transition-transform", practice.rulesOpened && "rotate-180")} aria-hidden />
                </button>
                {practice.rulesOpened && (
                  <div className="mt-2 animate-[tutorial-in_300ms_ease-out] space-y-1.5 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                    <p><strong className="text-ink-900">YES</strong> {TUTORIAL_MARKET.yesCriteria.replace(/^YES /, "")}</p>
                    <p><strong className="text-ink-900">NO</strong> {TUTORIAL_MARKET.noCriteria.replace(/^NO /, "")}</p>
                    <p className="text-xs text-ink-500">Sources: {TUTORIAL_MARKET.sources.join(" · ")}</p>
                  </div>
                )}
              </div>
            </Spot>

            <Spot id="numbers" active={active} className="mt-4">
              <div className="rounded-xl p-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-display text-3xl font-bold tabular-nums text-ink-900">{formatShare(share)}</p>
                    <p className="text-xs text-ink-600">YES allocation · share of credits on YES</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink-700">{formatShare(TUTORIAL_MARKET.openingBaseline)}</p>
                    <p className="text-xs text-ink-600">Opening baseline</p>
                  </div>
                </div>
                <AllocationBar share={share} baseline={TUTORIAL_MARKET.openingBaseline} className="mt-3" />
                <p className="mt-2 text-xs text-ink-500">
                  {yes + no} credits from {TUTORIAL_MARKET.forecasters + (practice.submitted ? 1 : 0)} forecasters · baseline: {TUTORIAL_MARKET.baselineMethodology}
                </p>
              </div>
            </Spot>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Spot id="side" active={active} hint={step.hint}>
                <fieldset className="rounded-xl p-3" disabled={!!practice.submitted}>
                  <legend className="mb-2 text-sm font-semibold text-ink-900">Your answer</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["YES", "NO"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={practice.side === s}
                        onClick={() => update({ side: s })}
                        className={cn(
                          "h-11 rounded-full border text-sm font-bold transition-colors",
                          practice.side === s
                            ? s === "YES"
                              ? "border-red-600 bg-red-600 text-white"
                              : "border-ink-900 bg-ink-900 text-surface"
                            : "border-ink-200 text-ink-700 hover:border-ink-300 hover:bg-ink-50",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </Spot>

              <Spot id="confidence" active={active} hint={step.hint}>
                <div className="rounded-xl p-3">
                  <label htmlFor="tutorial-probability" className="text-sm font-semibold text-ink-900">
                    How likely is YES?
                  </label>
                  <input
                    id="tutorial-probability"
                    type="range"
                    min={1}
                    max={99}
                    value={practice.probability ?? 50}
                    disabled={!!practice.submitted}
                    onChange={(e) => update({ probability: Number(e.target.value) })}
                    className="mt-3 w-full accent-red-600"
                  />
                  <p className="text-xs text-ink-600" aria-live="polite">
                    {practice.probability === null ? "Optional · not set" : `You think ${practice.probability}% chance of YES`}
                  </p>
                </div>
              </Spot>
            </div>

            <Spot id="credits" active={active} hint={step.hint} className="mt-4">
              <div className="rounded-xl p-3">
                <label htmlFor="tutorial-credits" className="text-sm font-semibold text-ink-900">
                  Practice credits
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={!!practice.submitted}
                      onClick={() => update({ amount: String(p), amountTouched: true })}
                      className={cn(
                        "h-9 rounded-full border px-3.5 text-sm font-semibold tabular-nums transition-colors",
                        practice.amount === String(p) ? "border-ink-900 bg-ink-900 text-surface" : "border-ink-200 text-ink-700 hover:bg-ink-50",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                  <input
                    id="tutorial-credits"
                    inputMode="numeric"
                    placeholder="Other"
                    value={practice.amount}
                    disabled={!!practice.submitted}
                    onChange={(e) => update({ amount: e.target.value, amountTouched: true })}
                    aria-invalid={practice.amountTouched && !!amountError}
                    aria-describedby="tutorial-credits-help"
                    className="h-9 w-24 rounded-full border border-ink-200 bg-surface px-3.5 text-sm tabular-nums"
                  />
                </div>
                <p id="tutorial-credits-help" className={cn("mt-2 text-xs", practice.amountTouched && amountError ? "text-red-700" : "text-ink-600")}>
                  {practice.amountTouched && amountError
                    ? amountError
                    : preview
                      ? `If ${practice.side} is right you'd get back about ${preview.payoutIfRight} credits (+${preview.profitIfRight}). If not, you lose the ${credits}.`
                      : "Pick a side to see what you'd get back."}
                </p>
              </div>
            </Spot>

            <Spot id="submit" active={active} hint={step.hint} className="mt-4">
              <div className="rounded-xl p-3">
                {practice.submitted ? (
                  <p className="flex animate-[tutorial-in_300ms_ease-out] items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
                    <Check className="size-4" aria-hidden />
                    Practice forecast placed: {practice.submitted.credits} on {practice.submitted.side}. YES allocation moved to {formatShare(share)}.
                  </p>
                ) : (
                  <Button
                    variant="accent"
                    className="w-full"
                    disabled={!practice.side || !!amountError}
                    onClick={() => practice.side && update({ submitted: { side: practice.side, credits } })}
                  >
                    Place practice forecast
                  </Button>
                )}
              </div>
            </Spot>

            <Spot id="resolution" active={active} hint={step.hint} className="mt-4">
              <div className="rounded-xl p-3">
                {practice.resolved ? (
                  <div className="animate-[tutorial-in_300ms_ease-out] space-y-2 text-sm">
                    <p className="font-semibold text-ink-900">
                      Resolved <span className="text-red-700">{TUTORIAL_RESOLUTION.outcome}</span> · approved by two admins
                    </p>
                    <p className="text-ink-700">{TUTORIAL_RESOLUTION.evidence}</p>
                    <p className="text-xs text-ink-500">Evidence: {TUTORIAL_RESOLUTION.evidenceSource}</p>
                    {practice.submitted && submittedPreview && (
                      <p className={cn("rounded-lg px-3 py-2 font-medium", won ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-ink-100 text-ink-700")}>
                        {won
                          ? `You were right: ${submittedPreview.payoutIfRight} practice credits came back (+${submittedPreview.profitIfRight}).`
                          : `NO didn't happen this time, so your ${practice.submitted.credits} practice credits went to the YES side.`}
                      </p>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" disabled={!practice.submitted} onClick={() => update({ resolved: true })}>
                    <FastForward className="size-4" aria-hidden /> Fast-forward to the deadline
                  </Button>
                )}
              </div>
            </Spot>
          </div>

        </div>
        {started && (
          <p className="px-1 text-xs text-ink-500 max-lg:hidden">
            Practice mode: nothing here changes your real credits or places a real forecast. Press Esc to exit.
          </p>
        )}

      </div>
    </div>
  );
}

function stepComplete(id: string, p: Practice, amountError: string | null): boolean {
  switch (id) {
    case "startup":
      return p.startupOpened;
    case "question":
      return p.rulesOpened;
    case "numbers":
      return p.quizAnswer === "allocation";
    case "side":
      return p.side !== null;
    case "confidence":
      return p.probability !== null;
    case "credits":
      return p.submitted !== null || (p.side !== null && amountError === null);
    case "submit":
      return p.submitted !== null;
    case "resolution":
      return p.resolved;
    default:
      return true;
  }
}

function StepFeedback({ step, practice, complete }: { step: TutorialStep; practice: Practice; complete: boolean }) {
  if (step.id === "numbers") {
    if (practice.quizAnswer === "baseline") return <Hint>Close: the baseline is a starting estimate set when the market opened, not where credits are now.</Hint>;
    if (practice.quizAnswer === "probability") return <Hint>Not quite. The share of credits isn&apos;t a probability; it&apos;s just how credits are split.</Hint>;
  }
  if (step.id === "credits" && !practice.side) return <Hint>Go back one step and pick YES or NO first.</Hint>;
  if (!complete || step.id === "done") return null;
  const message: Record<string, string> = {
    startup: "Nice. Now you know who the market is about.",
    question: "Good habit: always read the criteria first.",
    numbers: "Exactly. The YES allocation is the community's credit split.",
    side: `You picked ${practice.side}.`,
    confidence: "Saved. Senzi compares this with outcomes to score your calibration.",
    credits: "Looks good. You can still change it before submitting.",
    submit: "Your practice forecast is in. Notice the allocation moved.",
    resolution: "That's the full loop.",
  };
  return (
    <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
      <Check className="size-4 shrink-0" aria-hidden /> {message[step.id]}
    </p>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
      <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{children}</span>
    </p>
  );
}

function NumbersQuiz({ answer, onAnswer }: { answer: Practice["quizAnswer"]; onAnswer: (a: NonNullable<Practice["quizAnswer"]>) => void }) {
  const options = [
    { id: "baseline" as const, label: `Opening baseline · ${formatShare(TUTORIAL_MARKET.openingBaseline)}` },
    { id: "allocation" as const, label: `YES allocation · ${formatShare(allocationShare(TUTORIAL_MARKET.yesCredits, TUTORIAL_MARKET.noCredits))}` },
    { id: "probability" as const, label: "The chance it happens" },
  ];
  return (
    <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Which number shows how credits are split?">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={answer === o.id}
          onClick={() => onAnswer(o.id)}
          className={cn(
            "rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-colors",
            answer === o.id
              ? o.id === "allocation"
                ? "border-emerald-600 bg-emerald-500/10 text-ink-900 dark:border-emerald-400"
                : "border-amber-500 bg-amber-400/10 text-ink-900 dark:border-amber-300"
              : "border-ink-200 text-ink-700 hover:bg-ink-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Highlights one part of the practice market and dims the rest. */
function Spot({
  id,
  active,
  hint,
  className,
  children,
}: {
  id: Target;
  active: Target | null;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const isActive = active === id;
  const dimmed = active !== null && !isActive;
  return (
    <div
      data-spot={id}
      className={cn(
        "relative scroll-mt-6 rounded-xl transition-all duration-300",
        isActive && "z-10 bg-surface ring-2 ring-red-500 ring-offset-2 ring-offset-surface shadow-[0_0_0_6px_rgb(255_44_44/0.08)]",
        dimmed && "pointer-events-none opacity-35 saturate-50",
        className,
      )}
      inert={dimmed || undefined}
    >
      {isActive && hint && (
        <span className="absolute -top-3 right-3 z-20 -translate-y-1/2 animate-[tutorial-pop_400ms_ease-out] rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-md after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-red-600">
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}
