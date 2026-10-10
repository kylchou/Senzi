"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { cn } from "./cn";
import { getMe } from "./me-client";

/**
 * Link to Darsh's VC workspace, shown only to signed-in members of at least
 * one organization (from GET /api/users/me). Everyone else never sees it.
 */
export function VcLink({ active, className }: { active: boolean; className?: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [member, setMember] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let current = true;
    getMe().then((me) => current && setMember((me?.memberships.length ?? 0) > 0));
    return () => {
      current = false;
    };
  }, [isLoaded, isSignedIn]);

  if (!isSignedIn || !member) return null;
  return (
    <Link href="/vc" aria-current={active ? "page" : undefined} className={cn(className, active && "text-ink-900")}>
      Intelligence
    </Link>
  );
}
