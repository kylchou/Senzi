"use client";

import Link from "next/link";
import { useIsVcAccount } from "@/components/ui/account-type";

/**
 * Renders trading UI for everyone except VC accounts, which sponsor questions
 * and never trade (the forecast API refuses them too). VCs see a short note
 * pointing at their research workspace instead.
 */
export function TraderOnly({ children }: { children: React.ReactNode }) {
  if (useIsVcAccount()) {
    return (
      <div className="surface-card p-5 text-sm text-ink-600">
        <p className="font-medium text-ink-900">VC accounts don&apos;t trade</p>
        <p className="mt-1">
          You can read this market, but forecasting is for trader accounts. Your firm&apos;s questions and research are in{" "}
          <Link href="/vc" className="underline">
            Intelligence
          </Link>
          .
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
