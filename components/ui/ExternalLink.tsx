import { ArrowUpRight } from "lucide-react";
import { cn } from "./cn";

export function ExternalLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-red-500",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
