import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Clock } from "lucide-react";
import { AccountTypeChoice } from "@/components/auth/AccountTypeChoice";
import { VcVerificationForm } from "@/components/auth/VcVerificationForm";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/Skeleton";
import { homePathFor, requireUserPage } from "@/lib/auth";
import { latestVcVerification } from "@/lib/verification";
import { bypassVerificationAction, chooseAccountTypeAction, switchToTraderAction } from "./actions";

export const metadata: Metadata = { title: "Set up your account", robots: { index: false } };

/** Every sign-in lands here. Sends verified people on; otherwise finishes setup. */
export default function OnboardingPage({ searchParams }: { searchParams: Promise<{ bypass?: string }> }) {
  return (
    <main id="main" className="flex-1">
      <Container className="py-12 sm:py-20">
        <Suspense fallback={<Skeleton className="mx-auto h-64 max-w-2xl rounded-[var(--radius-card)]" />}>
          <Setup searchParams={searchParams} />
        </Suspense>
      </Container>
    </main>
  );
}

async function Setup({ searchParams }: { searchParams: Promise<{ bypass?: string }> }) {
  const user = await requireUserPage("/onboarding");
  if (user.accountType && user.accountVerifiedAt) redirect(homePathFor(user));

  if (!user.accountType) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-center text-3xl font-bold text-ink-900">One more step</h1>
        <p className="mb-6 text-center text-ink-600">How will you use Senzi?</p>
        <form action={chooseAccountTypeAction}>
          <AccountTypeChoice />
        </form>
      </div>
    );
  }

  // Trader accounts are verified on choice, so only VCs reach this point.
  const latest = await latestVcVerification(user.id);
  const bypassEnabled = !!process.env.DEMO_VC_BYPASS_CODE;
  const bypassInvalid = (await searchParams).bypass === "invalid";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {latest?.status === "PENDING" ? (
        <div className="surface-card p-6 text-center">
          <Clock className="mx-auto size-7 text-red-700" aria-hidden />
          <h1 className="mt-3 text-2xl font-bold text-ink-900">We&apos;re checking your firm details</h1>
          <p className="mt-2 text-ink-600">
            A Senzi admin reviews every VC account, usually within a business day. We&apos;ll notify you when it&apos;s done.
          </p>
          <p className="mt-4 text-sm text-ink-500">
            Sent for {latest.firmName} as {latest.jobTitle} ({latest.workEmail}).
          </p>
          {bypassEnabled && (
            <form action={bypassVerificationAction} className="mt-6 flex flex-col items-center gap-2 border-t border-ink-200 pt-4">
              <label htmlFor="bypass-code" className="text-sm text-ink-500">
                Demo access code
              </label>
              <div className="flex gap-2">
                <input
                  id="bypass-code"
                  name="code"
                  type="password"
                  autoComplete="off"
                  required
                  className="rounded-xl border border-ink-200 bg-transparent px-3 py-1.5 text-sm"
                />
                <Button type="submit" size="sm">
                  Skip review
                </Button>
              </div>
              {bypassInvalid && (
                <p role="status" className="text-sm text-red-700">
                  That code isn&apos;t right.
                </p>
              )}
            </form>
          )}
        </div>
      ) : (
        <div>
          <h1 className="mb-2 text-3xl font-bold text-ink-900">Verify your VC account</h1>
          <p className="mb-4 text-ink-600">
            VC accounts can see private research, so a Senzi admin checks each one. If your firm is already on Senzi, ask its admin to
            invite you instead; that verifies you right away.
          </p>
          {latest?.status === "REJECTED" && latest.reviewNote && (
            <p role="status" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
              Your last request wasn&apos;t approved: {latest.reviewNote}
            </p>
          )}
          <VcVerificationForm />
        </div>
      )}

      <form action={switchToTraderAction} className="text-center text-sm text-ink-600">
        Here to forecast instead?{" "}
        <Button type="submit" variant="ghost" size="sm">
          Use a trader account
        </Button>
      </form>
    </div>
  );
}
