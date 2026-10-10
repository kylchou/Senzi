import Link from "next/link";
import { Suspense } from "react";
import { AuthControls } from "../_components/auth-controls";

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/startups", label: "Startups" },
  { href: "/admin/markets", label: "Markets" },
  { href: "/admin/resolutions", label: "Resolutions" },
  { href: "/admin/news", label: "News" },
  { href: "/admin/users", label: "Users & credits" },
  { href: "/admin/verifications", label: "Verifications" },
  { href: "/admin/product-users", label: "Product users" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

// The shell is static. Each page checks the admin session itself
// (requireAdminPage) inside this Suspense boundary.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8 md:flex-row">
      <aside className="md:w-48 md:shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Senzi admin</p>
          <AuthControls />
        </div>
        <nav className="flex gap-3 text-sm md:flex-col md:gap-1">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
