import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionHeading({
  title,
  eyebrow,
  href,
  linkLabel = "View all",
}: {
  title: string;
  eyebrow?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-700">{eyebrow}</p>}
        <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">{title}</h2>
      </div>
      {href && (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          {linkLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
