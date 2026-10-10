import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Disclaimer } from "@/components/vc/Disclaimer";
import { VcNav } from "@/components/vc/VcNav";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export const metadata: Metadata = {
  title: "VentureCast Intelligence",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function VcLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePageContext("/vc");
  const unreadAlerts = await getVcServices().alerts.unreadCount(ctx);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <VcNav
        memberships={ctx.memberships}
        activeOrgId={ctx.activeOrg?.organizationId ?? null}
        unreadAlerts={unreadAlerts}
        isPlatformAdmin={ctx.user.isPlatformAdmin}
      />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8">
        <Disclaimer />
      </footer>
    </div>
  );
}
