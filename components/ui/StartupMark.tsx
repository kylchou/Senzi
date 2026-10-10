import { cn } from "./cn";

/** Startup logo, or a monogram when no logo is on file. */
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
  const dims = { sm: "size-7 text-xs rounded-md", md: "size-10 text-sm rounded-lg", lg: "size-16 text-xl rounded-xl" }[size];
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className={cn(dims, "shrink-0 border border-ink-200 bg-white object-contain", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(dims, "inline-flex shrink-0 items-center justify-center bg-ink-900 font-display font-bold text-white", className)}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
