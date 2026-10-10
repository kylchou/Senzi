"use client";

import { useEffect, useState } from "react";
import { motionReduced } from "./a11y/preferences";
import { cn } from "./cn";

type Kind = "share" | "count";

function format(value: number | null, kind: Kind): string {
  if (value === null || Number.isNaN(value)) return "N/A";
  return kind === "share" ? `${Math.round(value * 100)}%` : new Intl.NumberFormat("en-US").format(Math.round(value));
}


/**
 * A number that counts to its new value and briefly highlights when it
 * changes (for example after a forecast refreshes the page). The first render
 * shows the final value, so server HTML and hydration always match.
 */
export function AnimatedNumber({
  value,
  kind = "count",
  className,
}: {
  value: number | null;
  kind?: Kind;
  className?: string;
}) {
  const [previous, setPrevious] = useState(value);
  const [tween, setTween] = useState<{ from: number; to: number; id: number } | null>(null);
  const [current, setCurrent] = useState<number | null>(null);

  // Adjust state while rendering when the value prop changes (no effect needed).
  if (value !== previous) {
    setPrevious(value);
    if (previous !== null && value !== null && !motionReduced()) {
      setTween({ from: previous, to: value, id: (tween?.id ?? 0) + 1 });
      setCurrent(previous);
    } else {
      setTween(null);
      setCurrent(null);
    }
  }

  useEffect(() => {
    if (!tween) return;
    const start = performance.now();
    const duration = 650;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setCurrent(t < 1 ? tween.from + (tween.to - tween.from) * eased : null);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tween]);

  return (
    <span className={cn("relative inline-block tabular-nums", className)}>
      {tween && (
        <span
          key={tween.id}
          aria-hidden
          className="absolute -inset-x-1.5 -inset-y-0.5 -z-10 animate-[value-flash_1200ms_ease-out_forwards] rounded-md bg-red-100"
        />
      )}
      {format(current ?? value, kind)}
    </span>
  );
}
