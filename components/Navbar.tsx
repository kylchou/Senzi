"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Building2, House, LineChart, Newspaper, Pencil, Search, type LucideIcon } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { openCommandPalette, ShortcutHint } from "@/components/ui/CommandPalette";
import { NotificationsBell } from "@/components/ui/NotificationsBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { VcLink } from "@/components/ui/VcLink";
import { cn } from "@/components/ui/cn";
import { useRememberedHref } from "@/components/ui/remembered-filters";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Homepage section highlighted while it's in view (the homepage only). */
  section?: string;
  /** Exact match only (Home, and in-page links). */
  exact?: boolean;
  /** Reopen the listing with its last-used filters. */
  remember?: boolean;
}

const links: NavItem[] = [
  { href: "/", label: "Home", icon: House, section: "top", exact: true },
  { href: "/markets", label: "Markets", icon: LineChart, section: "explore", remember: true },
  // "#tutorial" also starts the walkthrough (see HowItWorksTutorial).
  { href: "/#tutorial", label: "How it works", icon: Pencil, section: "how-it-works", exact: true },
  { href: "/startups", label: "Startups", icon: Building2, section: "startups", remember: true },
  { href: "/news", label: "News", icon: Newspaper, remember: true },
];

/** Homepage section ids, top to bottom. */
const HOME_SECTIONS = ["top", "explore", "how-it-works", "startups"];

function isActive(pathname: string | null, href: string) {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
}

/**
 * The pathname is unknown while dynamic routes prerender, so the routed links
 * sit in Suspense behind identical links without the active state. On small
 * screens navigation lives in the bottom tab bar (BottomNav).
 */
export function Navbar() {
  return (
    <header
      className="sticky top-0 z-40 px-3 pt-3 sm:px-4"
      // Stays still while page content transitions underneath.
      style={{ viewTransitionName: "site-header" }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-ink-900"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-full bg-night pl-5 pr-2 text-white shadow-[0_14px_36px_-18px_rgb(0_0_0/0.55)] ring-1 ring-white/5">
        <Link href="/" aria-label="Senzi home" className="shrink-0">
          <Image src="/senzi-logo.png" alt="Senzi" width={77} height={22} priority />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          <Suspense fallback={<NavLinks pathname={null} />}>
            <RoutedNavLinks />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search"
            className="hidden h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3 pr-2 text-sm text-mist-300 transition-colors hover:border-white/20 hover:text-white md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden pr-6 xl:inline">Search</span>
            <ShortcutHint className="rounded border border-white/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-mist-400" />
          </button>
          <ThemeToggle />
          <NotificationsBell />
          <div className="hidden md:block">
            <AuthControls />
          </div>
        </div>
      </div>
    </header>
  );
}

function RoutedNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

/** Which homepage section is in view, for highlighting the matching link. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        // The topmost section that is meaningfully on screen wins.
        setActive(HOME_SECTIONS.find((id) => (visible.get(id) ?? 0) > 0.15) ?? null);
      },
      { rootMargin: "-72px 0px -40% 0px", threshold: [0, 0.15, 0.4] },
    );
    for (const id of HOME_SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled]);
  return enabled ? active : null;
}

const linkClass =
  "group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-white/5 hover:text-white";

function NavLinks({ pathname }: { pathname: string | null }) {
  const onHome = pathname === "/";
  const section = useActiveSection(onHome);
  return (
    <>
      {links.map((link) => {
        const active = onHome
          ? link.section !== undefined && link.section === section
          : !link.exact && isActive(pathname, link.href);
        return <NavLink key={link.href} link={link} active={active} inPage={onHome && active} />;
      })}
      <VcLink active={isActive(pathname, "/vc")} className={linkClass} />
    </>
  );
}

function NavLink({ link, active, inPage }: { link: NavItem; active: boolean; inPage: boolean }) {
  const remembered = useRememberedHref(link.href);
  return (
    <Link
      href={link.remember ? remembered : link.href}
      aria-current={active ? (inPage ? "location" : "page") : undefined}
      aria-label={link.label}
      title={link.label}
      className={cn(linkClass, active && "bg-white/10 text-white")}
    >
      <link.icon
        className={cn("size-4 transition-colors", active ? "text-red-500" : "text-mist-400 group-hover:text-white")}
        aria-hidden
      />
      <span className="hidden lg:inline">{link.label}</span>
    </Link>
  );
}
