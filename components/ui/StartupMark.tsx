import { cn } from "./cn";

/** Brand-adjacent tints. Each pairs a background with text that passes AA in both themes. */
const TINTS = [
  "bg-ink-900 text-surface",
  "bg-red-600 text-white",
  "bg-red-50 text-red-700 ring-1 ring-inset ring-red-100",
  "bg-ink-100 text-ink-800 ring-1 ring-inset ring-ink-200",
  "bg-ink-700 text-surface",
  "bg-surface text-ink-900 ring-1 ring-inset ring-ink-300",
];

/** Stable tint for a name, so a startup always gets the same color. */
export function tintIndex(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % TINTS.length;
}

/** Up to two initials: "Northwind Robotics" becomes "NR", "Acme" becomes "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** Startup logo, or tinted initials when no logo is on file. */
export function StartupMark({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = {
    sm: "size-7 text-[10px] rounded-md",
    md: "size-10 text-xs rounded-lg",
    lg: "size-16 text-lg rounded-xl",
  }[size];
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className={cn(dims, "shrink-0 border border-ink-200 bg-surface object-contain", className)} />;
  }
  return (
    <span
      aria-hidden
      translate="no"
      className={cn(
        dims,
        "inline-flex shrink-0 items-center justify-center font-display font-bold tracking-tight",
        TINTS[tintIndex(name)],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
