import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountTypeChoice } from "@/components/auth/AccountTypeChoice";
import { Container } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/Skeleton";
import { homePathFor, requireUserPage } from "@/lib/auth";
import { chooseAccountTypeAction } from "./actions";

export const metadata: Metadata = { title: "Choose your account", robots: { index: false } };

/** Every sign-in lands here. Sends people on, or asks once for their account type. */
export default function OnboardingPage() {
  return (
    <main id="main" className="flex-1">
      <Container className="py-12 sm:py-20">
        <Suspense fallback={<Skeleton className="mx-auto h-64 max-w-2xl rounded-[var(--radius-card)]" />}>
          <Choose />
        </Suspense>
      </Container>
    </main>
  );
}

async function Choose() {
  const user = await requireUserPage("/onboarding");
  if (user.accountType) redirect(homePathFor(user.accountType));
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
