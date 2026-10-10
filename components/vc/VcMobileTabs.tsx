"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { hasVcAccess, switchVcOrg, useVcWorkspace } from "@/components/ui/vc-workspace";
import { REVIEW_LINK, VC_LINKS, isActiveLink } from "./nav-links";

/**
 * The Intelligence pages on phones, where the site header has no links: a
 * slim tab row plus the organization switcher. Hidden from md up, where the
 * header's Intelligence menu does this.
 */
export function VcMobileTabs() {
  const workspace = useVcWorkspace();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const links = hasVcAccess(workspace) && workspace.isPlatformAdmin ? [...VC_LINKS, REVIEW_LINK] : VC_LINKS;
  const orgs = workspace?.memberships ?? [];

  return (
    <div className="border-b border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <nav aria-label="Intelligence" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = isActiveLink(l, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm ${
                  active ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-50" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        {orgs.length > 1 && (
          <select
            aria-label="Organization"
            className="max-w-[9rem] shrink-0 truncate rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={workspace?.activeOrgId ?? ""}
            disabled={switching}
            onChange={async (e) => {
              setSwitching(true);
              try {
                await switchVcOrg(e.target.value);
                router.refresh();
              } finally {
                setSwitching(false);
              }
            }}
          >
            {orgs.map((m) => (
              <option key={m.organizationId} value={m.organizationId}>
                {m.organizationName}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
