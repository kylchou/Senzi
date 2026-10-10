import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badgeStyles = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-ink-100 text-ink-700",
      live: "bg-red-50 text-red-700",
      dark: "bg-ink-900 text-surface",
      outline: "border border-ink-200 text-ink-700",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  dot,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles> & { dot?: boolean }) {
  return (
    <span className={cn(badgeStyles({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
