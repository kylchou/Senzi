"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { getMe } from "./me-client";

export type AccountKind = "VC" | "TRADER";

/**
 * The signed-in user's account type (from GET /api/users/me), or null while
 * loading, when signed out, or before they've chosen one. VC accounts don't
 * trade, so trading UI hides itself for them.
 */
export function useAccountType(): AccountKind | null {
  const { isLoaded, isSignedIn } = useAuth();
  const [type, setType] = useState<AccountKind | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let current = true;
    getMe().then((me) => current && setType(me?.accountType ?? null));
    return () => {
      current = false;
    };
  }, [isLoaded, isSignedIn]);
  return isSignedIn ? type : null;
}

/** True for VC accounts: hide trading entry points. */
export function useIsVcAccount(): boolean {
  return useAccountType() === "VC";
}
