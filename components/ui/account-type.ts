"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { getMe } from "./me-client";

export type AccountKind = "VC" | "TRADER";

/**
 * The signed-in user's account type (from GET /api/users/me). `loading` is true
 * while a signed-in user's type is still being fetched.
 */
function useAccountTypeState(): { loading: boolean; type: AccountKind | null } {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [fetched, setFetched] = useState<{ userId: string; type: AccountKind | null } | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    let current = true;
    getMe(userId).then((me) => current && setFetched({ userId, type: me?.accountType ?? null }));
    return () => {
      current = false;
    };
  }, [isLoaded, isSignedIn, userId]);
  if (!isLoaded) return { loading: true, type: null };
  if (!isSignedIn) return { loading: false, type: null };
  if (fetched?.userId !== userId) return { loading: true, type: null };
  return { loading: false, type: fetched.type };
}

/**
 * The signed-in user's account type, or null while loading, when signed out,
 * or before they've chosen one. VC accounts don't trade, so trading UI hides
 * itself for them.
 */
export function useAccountType(): AccountKind | null {
  return useAccountTypeState().type;
}

/** True for VC accounts: hide trading entry points. */
export function useIsVcAccount(): boolean {
  return useAccountType() === "VC";
}

/**
 * True when trading entry points (Markets, How it works) should show: signed
 * out or a non-VC account. False while the account type is loading, so VCs
 * never see the links flash in.
 */
export function useShowTradingUi(): boolean {
  const { loading, type } = useAccountTypeState();
  return !loading && type !== "VC";
}
