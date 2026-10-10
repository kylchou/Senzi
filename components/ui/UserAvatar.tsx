import { cn } from "./cn";

const TINTS = [
  "bg-red-50 text-red-700",
  "bg-ink-100 text-ink-800",
  "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
  "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function tint(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** A person's profile picture, or tinted initials when they have none. */
export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: {
  name: string;
  avatarUrl: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const dims = size === "sm" ? "size-7 text-[10px]" : "size-9 text-xs";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn(dims, "shrink-0 rounded-full bg-ink-100 object-cover ring-1 ring-hairline", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      translate="no"
      className={cn(dims, "inline-grid shrink-0 place-items-center rounded-full font-display font-bold", tint(name), className)}
    >
      {initials(name)}
    </span>
  );
}
