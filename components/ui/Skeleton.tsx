import { cn } from "./cn";

/** Placeholder block with a soft shimmer. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md bg-ink-100",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:via-ink-50/70 after:to-transparent",
        className,
      )}
    />
  );
}

/** Same shape as MarketCard, so the grid does not jump when data arrives. */
export function MarketCardSkeleton() {
  return (
    <div aria-hidden className="flex h-full flex-col surface-card p-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-7 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        <Skeleton className="ml-auto h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-5 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      <div className="mt-8 flex items-end justify-between">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-4 w-10" />
      </div>
      <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
      <div className="mt-5 flex justify-between border-t border-ink-100 pt-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

/** Same shape as StartupCard. */
export function StartupCardSkeleton() {
  return (
    <div aria-hidden className="flex h-full flex-col surface-card p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3.5 w-full" />
      <Skeleton className="mt-2 h-3.5 w-2/3" />
      <Skeleton className="mt-6 h-3 w-32" />
    </div>
  );
}

export function CardGridSkeleton({
  count,
  variant = "market",
  className,
}: {
  count: number;
  variant?: "market" | "startup";
  className?: string;
}) {
  const Card = variant === "market" ? MarketCardSkeleton : StartupCardSkeleton;
  return (
    <div role="status" aria-label="Loading" className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} />
      ))}
    </div>
  );
}
