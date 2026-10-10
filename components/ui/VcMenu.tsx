"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { REVIEW_LINK, VC_LINKS, isActiveLink } from "@/components/vc/nav-links";
import { cn } from "./cn";
import { hasVcAccess, switchVcOrg, useVcWorkspace } from "./vc-workspace";

/**
 * "Intelligence" in the site header: a menu with the VC section's pages and,
 * for people in more than one firm, the organization switcher. Shown only to
 * firm members and platform admins; replaces the old second nav bar.
 */
export function VcMenu({ className, pathname: currentPath }: { className?: string; pathname: string | null }) {
  const workspace = useVcWorkspace();
  // Null while the header prerenders; the routed copy passes the real path.
  const pathname = currentPath ?? "";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Close on outside click and Escape; links close it themselves when followed.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hasVcAccess(workspace)) return null;
  const links = workspace.isPlatformAdmin ? [...VC_LINKS, REVIEW_LINK] : VC_LINKS;
  const inSection = pathname === "/vc" || pathname.startsWith("/vc/");
  const activeOrg = workspace.memberships.find((m) => m.organizationId === workspace.activeOrgId);

  async function choose(organizationId: string) {
    if (organizationId === workspace?.activeOrgId) return;
    setSwitching(true);
    setError(false);
    try {
      await switchVcOrg(organizationId);
      setOpen(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(className, "inline-flex items-center gap-1", inSection && "text-ink-900")}
      >
        Intelligence
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {inSection && (
          <span aria-hidden className="absolute inset-x-3 -bottom-[17px] h-0.5 rounded-full bg-red-500" />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute left-0 top-full z-50 mt-3 w-64 rounded-xl border border-hairline bg-surface p-1.5 text-sm shadow-[var(--shadow-lift)]"
        >
          <nav aria-label="Intelligence">
            <ul>
              {links.map((l) => {
                const active = isActiveLink(l, pathname);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-3 py-2 text-ink-700 hover:bg-ink-100 hover:text-ink-900",
                        active && "font-medium text-ink-900",
                      )}
                    >
                      {l.label}
                      {active && <span aria-hidden className="size-1.5 rounded-full bg-red-500" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {workspace.memberships.length > 0 && (
            <div className="mt-1.5 border-t border-hairline pt-1.5">
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                {workspace.memberships.length > 1 ? "Organization" : "Working as"}
              </p>
              {workspace.memberships.length === 1 ? (
                <p className="px-3 pb-2 text-ink-900">{activeOrg?.organizationName ?? workspace.memberships[0]!.organizationName}</p>
              ) : (
                <ul role="radiogroup" aria-label="Organization">
                  {workspace.memberships.map((m) => {
                    const selected = m.organizationId === workspace.activeOrgId;
                    return (
                      <li key={m.organizationId}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={switching}
                          onClick={() => choose(m.organizationId)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-ink-700 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-60"
                        >
                          <span className={cn(selected && "font-medium text-ink-900")}>{m.organizationName}</span>
                          {selected && <Check className="size-4" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {error && <p className="px-3 pb-2 text-xs text-red-600">Couldn&apos;t switch. Try again.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
