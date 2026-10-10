import { formatShare } from "@/lib/market-view/format";
import { cn } from "./cn";

/**
 * YES share of allocated credits as a horizontal bar, with the opening
 * baseline marked as a tick so the two are never confused.
 */
export function AllocationBar({
  share,
  baseline,
  size = "md",
  tone = "light",
  knob = false,
  className,
}: {
  share: number | null;
  baseline?: number | null;
  size?: "sm" | "md";
  /** Use "dark" on charcoal surfaces. */
  tone?: "light" | "dark";
  /** Show a handle at the current share, like a slider (detail pages). */
  knob?: boolean;
  className?: string;
}) {
  const label =
    share === null
      ? "No credits allocated yet"
      : `YES allocation ${formatShare(share)}, NO allocation ${formatShare(1 - share)}` +
        (baseline != null ? `, opening baseline ${formatShare(baseline)}` : "");

  return (
    <div role="img" aria-label={label} className={cn("relative", className)}>
      <div className={cn("flex w-full gap-0.5 overflow-hidden rounded-full", size === "sm" ? "h-1.5" : "h-2.5")}>
        {share === null ? (
          <div className={cn("h-full w-full rounded-full", tone === "dark" ? "bg-white/15" : "bg-ink-100")} />
        ) : (
          <>
            {share > 0 && (
              // Grows in on first paint, then eases to new widths when the page refreshes.
              <div
                className="h-full origin-left animate-[grow-x_700ms_var(--ease-out-soft)] rounded-full bg-red-500 transition-[width] duration-700 ease-[var(--ease-out-soft)]"
                style={{ width: `${share * 100}%` }}
              />
            )}
            {share < 1 && <div className={cn("h-full flex-1 rounded-full", tone === "dark" ? "bg-white/15" : "bg-ink-200")} />}
          </>
        )}
      </div>
      {baseline != null && (
        <div
          aria-hidden
          className={cn("absolute w-0.5 -translate-x-1/2 rounded-full", tone === "dark" ? "bg-white" : "bg-ink-900", size === "sm" ? "-top-1 h-3.5" : "-top-1 h-[18px]")}
          style={{ left: `${baseline * 100}%` }}
        />
      )}
      {knob && share !== null && (
        <div
          aria-hidden
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 animate-[pop-in_400ms_var(--ease-out-soft)_300ms_both] rounded-full border-[3px] border-red-500 bg-surface shadow-[0_2px_6px_rgb(0_0_0/0.15)] transition-[left] duration-700 ease-[var(--ease-out-soft)]"
          style={{ left: `${share * 100}%` }}
        />
      )}
    </div>
  );
}
