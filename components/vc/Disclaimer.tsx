import { VC_DISCLAIMER } from "@/lib/vc/constants";

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 ${className}`}
    >
      {VC_DISCLAIMER}
    </p>
  );
}
