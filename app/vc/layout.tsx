import type { Metadata } from "next";
import { Suspense } from "react";
import { Disclaimer } from "@/components/vc/Disclaimer";
import { Tyche } from "@/components/vc/Tyche";
import { VcMobileTabs } from "@/components/vc/VcMobileTabs";
import { getVcContext } from "@/lib/vc/server/context";
import { isTycheConfigured } from "@/lib/vc/server/meta-muse";

export const metadata: Metadata = {
  title: "Senzi Intelligence",
  robots: { index: false, follow: false },
};

/** Tyche's corner bubble, for signed-in users only. Reads the session, so it renders inside Suspense. */
async function TycheMount() {
  const ctx = await getVcContext();
  if (!ctx) return null;
  return <Tyche enabled={isTycheConfigured()} />;
}

// The shell is static. Each page checks the session itself (requirePageContext)
// inside the Suspense boundary, as the admin area does.
export default function VcLayout({ children }: LayoutProps<"/vc">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {/* Desktop navigation is the header's Intelligence menu; phones get this row. */}
      <Suspense fallback={null}>
        <VcMobileTabs />
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
