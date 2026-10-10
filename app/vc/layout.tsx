import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Disclaimer } from "@/components/vc/Disclaimer";
import { Tyche } from "@/components/vc/Tyche";
import { VC_LINKS } from "@/components/vc/nav-links";
import { VcNav } from "@/components/vc/VcNav";
import { getVcContext } from "@/lib/vc/server/context";
import { isTycheConfigured } from "@/lib/vc/server/meta-muse";

export const metadata: Metadata = {
  title: "Senzi Intelligence",
  robots: { index: false, follow: false },
};

/** Per-user nav: org switcher and the review link for platform admins. */
async function NavData() {
  const ctx = await getVcContext();
  if (!ctx) return <StaticNav />;
  return (
    <VcNav
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrg?.organizationId ?? null}
      isPlatformAdmin={ctx.user.isPlatformAdmin}
    />
  );
}

/** Tyche's corner bubble, for signed-in users only. Reads the session, so it renders inside Suspense. */
async function TycheMount() {
  const ctx = await getVcContext();
  if (!ctx) return null;
  return <Tyche enabled={isTycheConfigured()} />;
}

/** Prerendered placeholder with the same links and no per-user or per-path state. */
function StaticNav() {
  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/vc" className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Senzi <span className="font-normal text-slate-500">Intelligence</span>
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
      <Suspense fallback={null}>
        <TycheMount />
      </Suspense>
    </div>
  );
}
