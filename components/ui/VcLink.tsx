"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { cn } from "./cn";

/**
 * Link to Darsh's VC workspace, shown only to signed-in members of at least
 * one organization (from GET /api/users/me). Everyone else never sees it.
 */
export function VcLink({ active, className }: { active: boolean; className?: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [member, setMember] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const controller = new AbortController();
    fetch("/api/users/me", { credentials: "same-origin", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: { memberships?: unknown[] } } | null) => setMember((body?.data?.memberships?.length ?? 0) > 0))
      .catch(() => undefined);
    return () => controller.abort();
  }, [isLoaded, isSignedIn]);

  if (!isSignedIn || !member) return null;
  return (
    <Link href="/vc" aria-current={active ? "page" : undefined} className={cn(className, active && "bg-white/10 text-white")}>
      Intelligence
    </Link>
  );
}
