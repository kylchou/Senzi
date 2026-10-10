"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { cn } from "./cn";

/**
 * Link to Darsh's VC workspace.
 *
 * TEMPORARY (Felix, Oct 10): shown to every signed-in user so the VC
 * dashboard can be previewed before account types exist. Once Ky's VC/trader
 * account types land, show it only when `me.accountType === "VC"`. /vc still
 * checks org membership on the server, so this exposes nothing new.
 */
export function VcLink({ active, className }: { active: boolean; className?: string }) {
  const { isSignedIn } = useAuth();

  if (!isSignedIn) return null;
  return (
    <Link href="/vc" aria-current={active ? "page" : undefined} className={cn(className, active && "bg-white/10 text-white")}>
      VC dashboard
    </Link>
  );
}
