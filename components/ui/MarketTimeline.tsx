import { formatDate } from "@/lib/market-view/format";
import type { TimelineStep } from "@/lib/market-view/insights";
import { cn } from "./cn";

/** Vertical lifecycle: opened, baseline, deadline, resolution, settlement. */
export function MarketTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <section aria-labelledby="timeline-heading" className="surface-card p-5">
      <h2 id="timeline-heading" className="font-display text-base font-bold text-ink-900">
        Timeline
      </h2>
      <ol className="mt-4">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[7px] top-4 h-[calc(100%-8px)] w-0.5 rounded-full",
                    step.state === "done" ? "bg-ink-300" : "bg-ink-100",
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative mt-1 size-4 shrink-0 rounded-full border-2",
                  step.state === "done" && "border-ink-900 bg-ink-900",
                  step.state === "current" && "border-red-500 bg-surface ring-4 ring-red-500/15",
                  step.state === "upcoming" && "border-ink-300 bg-surface",
                )}
              />
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", step.state === "upcoming" ? "text-ink-500" : "text-ink-900")}>
                  {step.label}
                  {step.state === "current" && <span className="sr-only"> (current step)</span>}
                </p>
                <p className="text-xs text-ink-500">
                  {[step.detail, step.date && formatDate(step.date)].filter(Boolean).join(" ")}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
