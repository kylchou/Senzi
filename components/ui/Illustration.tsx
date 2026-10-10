/**
 * Small line drawings for empty states, drawn in the brand palette. Strokes use
 * theme tokens so they read well in light and dark.
 */
export type IllustrationName = "markets" | "startups" | "news" | "search" | "generic";

export function Illustration({ name }: { name: IllustrationName }) {
  const common = { fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 120 72" className="h-16 w-28" aria-hidden>
      {name === "markets" && (
        <>
          <rect x="14" y="12" width="92" height="48" rx="8" className="fill-surface stroke-ink-300" {...common} />
          <path d="M26 44H44V36H62V40H78V26H94" className="stroke-ink-400" {...common} />
          <rect x="26" y="50" width="40" height="4" rx="2" className="fill-red-500" />
          <rect x="68" y="50" width="26" height="4" rx="2" className="fill-ink-200" />
          <circle cx="94" cy="26" r="4" className="fill-red-500" />
        </>
      )}
      {name === "startups" && (
        <>
          <rect x="18" y="16" width="38" height="40" rx="8" className="fill-surface stroke-ink-300" {...common} />
          <rect x="64" y="16" width="38" height="40" rx="8" className="fill-surface stroke-ink-300" {...common} />
          <rect x="26" y="24" width="12" height="12" rx="3" className="fill-ink-900" />
          <rect x="72" y="24" width="12" height="12" rx="3" className="fill-red-500" />
          <path d="M26 44H48M72 44H94M26 50H40M72 50H86" className="stroke-ink-300" {...common} />
        </>
      )}
      {name === "news" && (
        <>
          <rect x="22" y="12" width="76" height="50" rx="8" className="fill-surface stroke-ink-300" {...common} />
          <path d="M32 24H72M32 34H88M32 42H84M32 50H60" className="stroke-ink-300" {...common} />
          <circle cx="86" cy="24" r="5" className="fill-red-500" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="54" cy="34" r="18" className="fill-surface stroke-ink-400" {...common} strokeWidth={3} />
          <path d="M67 47L82 62" className="stroke-ink-400" {...common} strokeWidth={4} />
          <path d="M46 34H62" className="stroke-red-500" {...common} strokeWidth={3} />
        </>
      )}
      {name === "generic" && (
        <>
          <rect x="30" y="16" width="60" height="40" rx="8" className="fill-surface stroke-ink-300" {...common} />
          <path d="M42 30H78M42 40H66" className="stroke-ink-300" {...common} />
          <circle cx="82" cy="22" r="5" className="fill-red-500" />
        </>
      )}
    </svg>
  );
}
