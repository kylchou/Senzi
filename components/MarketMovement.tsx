import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatPointChange } from "@/lib/market-view/format";
import { cn } from "@/components/ui/cn";

/** Change in market probability over a window. Direction carries no judgment. */
export function MarketMovement({
  movement,
  className,
}: {
  movement: { delta: number; days: number } | null;
  className?: string;
}) {
  if (!movement) return null;
  const points = Math.round(movement.delta * 100);
  const Icon = points > 0 ? ArrowUpRight : points < 0 ? ArrowDownRight : ArrowRight;

  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium tabular-nums text-ink-700", className)}
    >
      <Icon className={cn("size-3.5", points !== 0 && "text-red-500")} aria-hidden />
      {formatPointChange(movement.delta)} in {movement.days} {movement.days === 1 ? "day" : "days"}
    </span>
  );
}
