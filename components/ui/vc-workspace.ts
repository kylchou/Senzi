"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

/** The signed-in user's VC workspaces (GET /api/vc/active-org), fetched once per page load. */
export interface VcWorkspace {
  memberships: { organizationId: string; organizationName: string; role: string }[];
  activeOrgId: string | null;
  isPlatformAdmin: boolean;
}

const CHANGED = "senzi:vc-workspace-changed";
let request: Promise<VcWorkspace | null> | null = null;

function load(): Promise<VcWorkspace | null> {
  request ??= fetch("/api/vc/active-org", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { data?: VcWorkspace } | null) => body?.data ?? null)
    .catch(() => null);
  return request;
}

/** Firm members and platform admins (for the review queue) get the Intelligence section. */
export function hasVcAccess(w: VcWorkspace | null): w is VcWorkspace {
  return !!w && (w.memberships.length > 0 || w.isPlatformAdmin);
}

/** The current user's workspaces; null while loading, when signed out, or on error. */
export function useVcWorkspace(): VcWorkspace | null {
  const { isLoaded, isSignedIn } = useAuth();
  const [workspace, setWorkspace] = useState<VcWorkspace | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let current = true;
    const refresh = () => load().then((w) => current && setWorkspace(w));
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => {
      current = false;
      window.removeEventListener(CHANGED, refresh);
    };
  }, [isLoaded, isSignedIn]);
  return isSignedIn ? workspace : null;
}

/** Switches the active firm and tells every menu to reload. Throws if the server refuses. */
export async function switchVcOrg(organizationId: string): Promise<void> {
  const res = await fetch("/api/vc/active-org", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!res.ok) throw new Error("Couldn't switch organization");
  request = null;
  window.dispatchEvent(new Event(CHANGED));
}
