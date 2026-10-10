import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Disclaimer } from "@/components/vc/Disclaimer";
import { VC_LINKS } from "@/components/vc/nav-links";
import { VcNav } from "@/components/vc/VcNav";
import { getVcServices } from "@/lib/vc/server/container";
import { getVcContext } from "@/lib/vc/server/context";

export const metadata: Metadata = {
  title: "VentureCast Intelligence",
  robots: { index: false, follow: false },
};

/** Per-user nav: org switcher, unread alert count, review link for platform admins. */
async function NavData() {
  const ctx = await getVcContext();
  if (!ctx) return <StaticNav />;
  const unreadAlerts = await getVcServices().alerts.unreadCount(ctx);
  return (
    <VcNav
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrg?.organizationId ?? null}
      unreadAlerts={unreadAlerts}
      isPlatformAdmin={ctx.user.isPlatformAdmin}
    />
  );
}

/** Prerendered placeholder with the same links and no per-user or per-path state. */
function StaticNav() {
  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/vc" className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          VentureCast <span className="font-normal text-slate-500">Intelligence</span>
        </Link>
        <nav aria-label="VC Intelligence" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {VC_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-400">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

// The shell is static. Each page checks the session itself (requirePageContext)
// inside the Suspense boundary, as the admin area does.
export default function VcLayout({ children }: LayoutProps<"/vc">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <Suspense fallback={<StaticNav />}>
        <NavData />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>{children}</Suspense>
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8">
        <Disclaimer />
      </footer>
    </div>
  );
}
