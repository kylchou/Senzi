"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

const TOUR_KEY = "senzi-tour-market-v1";

const STEPS = [
  {
    target: "baseline",
    title: "Opening baseline",
    body: "The starting estimate set before anyone forecasts, with the method behind it.",
  },
  {
    target: "allocation",
    title: "YES allocation",
    body: "The share of virtual credits placed on YES. It shows where the community stands. It is not a probability.",
  },
  {
    target: "calibrated",
    title: "Calibrated probability",
    body: "A probability from the forecasting engine, shown only once its track record supports it.",
  },
] as const;

type Rect = { top: number; left: number; width: number; height: number };

function seen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

/** Three-step walkthrough of the market figures, shown once per browser. */
export function MarketTour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  // Start shortly after the page settles, only for first-time visitors.
  useEffect(() => {
    if (seen()) return;
    const timer = window.setTimeout(() => setStep(0), 900);
    return () => window.clearTimeout(timer);
  }, []);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(TOUR_KEY, "done");
    } catch {
      // Without storage the tour simply shows again next visit.
    }
    setStep(null);
  }, []);

  const measure = useCallback(() => {
    if (step === null) return;
    const element = document.querySelector(`[data-tour="${STEPS[step].target}"]`);
    if (!element) return finish();
    const box = element.getBoundingClientRect();
    setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
  }, [step, finish]);

  useLayoutEffect(() => {
    if (step === null) return;
    const element = document.querySelector(`[data-tour="${STEPS[step].target}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    const frame = requestAnimationFrame(measure);
    const later = window.setTimeout(measure, 450);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(later);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("keydown", onKey);
    };
  }, [step, measure, finish]);

  if (step === null || !rect) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const pad = 8;
  const cardWidth = Math.min(320, window.innerWidth - 32);
  const below = rect.top + rect.height + 180 < window.innerHeight;
  const cardTop = below ? rect.top + rect.height + pad + 12 : Math.max(16, rect.top - pad - 12 - 170);
  const cardLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - cardWidth / 2), window.innerWidth - cardWidth - 16);

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Spotlight: an outline around the figure (not a ring, which would be replaced by the dimming shadow). */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-2xl outline-2 outline-offset-2 outline-red-500 [outline-style:solid] transition-all duration-300 ease-[var(--ease-out-soft)]"
        // Positioned with transform so moving between steps never counts as layout shift.
        style={{
          top: 0,
          left: 0,
          transform: `translate(${rect.left - pad}px, ${rect.top - pad}px)`,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px rgb(18 20 22 / 0.55)",
        }}
      />
      <button type="button" aria-label="Skip tour" tabIndex={-1} onClick={finish} className="absolute inset-0 cursor-default" />
      <div
        key={step}
        className="absolute animate-[vt-fade_220ms_ease-out] rounded-2xl bg-surface p-5 text-ink-900 shadow-[var(--shadow-lift)]"
        style={{ top: 0, left: 0, transform: `translate(${cardLeft}px, ${cardTop}px)`, width: cardWidth }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 font-display text-lg font-bold">
          {current.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all duration-300 ${index === step ? "w-5 bg-red-500" : "w-1.5 bg-ink-200"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={finish}>
              Skip
            </Button>
            <Button size="sm" autoFocus onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
