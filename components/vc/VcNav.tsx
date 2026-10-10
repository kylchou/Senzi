"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { vcFetch } from "@/lib/vc/client";
import type { OrgMembership } from "@/lib/vc/types";
import { inputClass } from "./styles";

const LINKS = [
  { href: "/vc", label: "Dashboard", exact: true },
  { href: "/vc/studies", label: "Studies" },
  { href: "/vc/watchlists", label: "Watchlists" },
  { href: "/vc/alerts", label: "Alerts" },
  { href: "/vc/reports", label: "Reports" },
];

export function VcNav({
  memberships,
  activeOrgId,
  unreadAlerts,
  isPlatformAdmin,
}: {
  memberships: OrgMembership[];
  activeOrgId: string | null;
  unreadAlerts: number;
  isPlatformAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const links = isPlatformAdmin ? [...LINKS, { href: "/vc/review", label: "Review queue" }] : LINKS;

  async function switchOrg(organizationId: string) {
    setSwitching(true);
    try {
      await vcFetch("/api/vc/active-org", { method: "POST", json: { organizationId } });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/vc" className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          VentureCast <span className="font-normal text-slate-500">Intelligence</span>
        </Link>
        <nav aria-label="VC Intelligence" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm ${
                  active
                    ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-50"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                {l.label}
                {l.href === "/vc/alerts" && unreadAlerts > 0 && (
                  <span className="ml-1.5 rounded-full bg-sky-600 px-1.5 text-xs font-semibold text-white">
                    {unreadAlerts > 99 ? "99+" : unreadAlerts}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {memberships.length > 1 && (
          <div>
            <label htmlFor="vc-org" className="sr-only">
              Organization
            </label>
            <select
              id="vc-org"
              className={`${inputClass} w-auto py-1.5`}
              value={activeOrgId ?? ""}
              disabled={switching}
              onChange={(e) => switchOrg(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </select>
          </div>
        )}
        {memberships.length === 1 && (
          <span className="text-sm text-slate-600 dark:text-slate-300">{memberships[0].organizationName}</span>
        )}
      </div>
    </div>
  );
}
