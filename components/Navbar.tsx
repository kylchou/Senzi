"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Building2, Compass, House, LayoutDashboard, Menu, Pencil, Search, X, type LucideIcon } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { Container } from "@/components/ui/Container";
import { cn } from "@/components/ui/cn";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Homepage section this item scrolls to; highlighted while it's in view. */
  section?: string;
  /** Other pages that count as this item being active. */
  paths?: string[];
  signedInOnly?: boolean;
}

/** Section ids on the homepage, top to bottom. */
const HOME_SECTIONS = ["top", "explore", "how-it-works", "startups"];

const items: NavItem[] = [
  { label: "Home", href: "/#top", icon: House, section: "top" },
  { label: "Explore", href: "/#explore", icon: Compass, section: "explore", paths: ["/markets"] },
  // "#tutorial" also starts the walkthrough (see HowItWorksTutorial).
  { label: "How it works", href: "/#tutorial", icon: Pencil, section: "how-it-works" },
  { label: "Startups", href: "/#startups", icon: Building2, section: "startups", paths: ["/startups"] },
  { label: "Dashboard", href: "/vc", icon: LayoutDashboard, paths: ["/vc"], signedInOnly: true },
];

function onPath(pathname: string | null, paths: string[] = []) {
  return pathname !== null && paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The pathname is unknown while dynamic routes prerender, so the routed navbar
 * sits in Suspense behind an identical navbar without the active state.
 */
export function Navbar() {
  return (
    <Suspense fallback={<NavbarView pathname={null} />}>
      <RoutedNavbar />
    </Suspense>
  );
}

function RoutedNavbar() {
  return <NavbarView pathname={usePathname()} />;
}

/** Which homepage section is in view, for highlighting the matching nav item. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const sections = HOME_SECTIONS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        // The topmost section that is meaningfully on screen wins.
        const current = HOME_SECTIONS.find((id) => (visible.get(id) ?? 0) > 0.15) ?? null;
        setActive(current);
      },
      { rootMargin: "-64px 0px -40% 0px", threshold: [0, 0.15, 0.4] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [enabled]);
  return enabled ? active : null;
}

function NavbarView({ pathname }: { pathname: string | null }) {
  const { isSignedIn } = useAuth();
  // Menu belongs to the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = pathname !== null && openOn === pathname;
  const onHome = pathname === "/";
  const activeSection = useActiveSection(onHome);

  const visibleItems = items.filter((item) => !item.signedInOnly || isSignedIn);
  const isActive = (item: NavItem) => (onHome ? item.section === activeSection : onPath(pathname, item.paths));

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-900 text-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-ink-900"
      >
        Skip to content
      </a>
      <Container className="flex h-16 items-center gap-6">
        <Link href="/#top" aria-label="Senzi home" className="shrink-0">
          <Image src="/senzi-logo.png" alt="Senzi" width={77} height={22} priority />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {visibleItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? (onHome && item.section ? "location" : "page") : undefined}
                className={cn(
                  "group relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-300 transition-colors duration-200 hover:bg-white/5 hover:text-white",
                  active && "bg-white/10 text-white",
                )}
              >
                <item.icon
                  className={cn("size-4 transition-colors", active ? "text-red-500" : "text-ink-400 group-hover:text-white")}
                  aria-hidden
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link
            href="/search"
            aria-label="Search"
            aria-current={pathname === "/search" ? "page" : undefined}
            className={cn(
              "rounded-full p-2 text-ink-300 transition-colors hover:bg-white/10 hover:text-white",
              pathname === "/search" && "bg-white/10 text-white",
            )}
          >
            <Search className="size-5" aria-hidden />
          </Link>
          <AuthControls />
        </div>

        <button
          type="button"
          className="ml-auto rounded-full p-2 text-ink-300 hover:bg-white/10 hover:text-white md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </Container>

      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-white/10 md:hidden">
          <Container className="flex flex-col gap-1 py-3">
            {[...visibleItems, { label: "Search", href: "/search", icon: Search, paths: ["/search"] } as NavItem].map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpenOn(null)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300 hover:bg-white/5 hover:text-white",
                    active && "bg-white/5 text-white",
                  )}
                >
                  <item.icon className={cn("size-4", active ? "text-red-500" : "text-ink-400")} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
            <AuthControls variant="accent" className="mt-2 w-full" />
          </Container>
        </nav>
      )}
    </header>
  );
}
