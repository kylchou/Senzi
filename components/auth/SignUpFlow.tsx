"use client";

import { useState } from "react";
import { SignUp } from "@clerk/nextjs";
import { AccountTypeChoice } from "@/components/auth/AccountTypeChoice";
import type { AccountType } from "@/lib/types";

/** Pick an account type, then Clerk's form. The choice rides along as unsafeMetadata. */
export function SignUpFlow() {
  const [type, setType] = useState<AccountType | null>(null);

  if (!type) {
    return (
      <div className="w-full max-w-2xl">
        <h1 className="mb-2 text-center text-3xl font-bold text-ink-900">Join Senzi</h1>
        <p className="mb-6 text-center text-ink-600">What brings you here?</p>
        <AccountTypeChoice onPick={setType} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-ink-600">
        Signing up as {type === "VC" ? "a VC" : "a trader"}.{" "}
        <button type="button" onClick={() => setType(null)} className="font-semibold text-ink-900 hover:underline">
          Change
        </button>
      </p>
      <SignUp unsafeMetadata={{ accountType: type }} forceRedirectUrl="/onboarding" />
    </div>
  );
}
