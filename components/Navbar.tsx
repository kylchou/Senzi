"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Search } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { openCommandPalette, ShortcutHint } from "@/components/ui/CommandPalette";
import { NotificationsBell } from "@/components/ui/NotificationsBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { AccessibilityMenu } from "@/components/ui/a11y/AccessibilityMenu";
import { LanguageMenu } from "@/components/ui/i18n/LanguageMenu";
import { VcMenu } from "@/components/ui/VcMenu";
import { useShowTradingUi } from "@/components/ui/account-type";
import { cn } from "@/components/ui/cn";
import { useRememberedHref } from "@/components/ui/remembered-filters";

interface NavItem {
  href: string;
  label: string;
  /** Homepage section highlighted while it's in view (the homepage only). */
  section?: string;
  /** Exact match only (Home, and in-page links). */
  exact?: boolean;
  /** Reopen the listing with its last-used filters. */
  remember?: boolean;
  /** Only shown when signed in. */
  signedIn?: boolean;
  /** Trader-only page (trading, portfolios): hidden for VC accounts, and until the account type loads. */
  tradersOnly?: boolean;
}

// The logo links home, so there is no separate Home link.
const links: NavItem[] = [
  { href: "/markets", label: "Markets", section: "explore", remember: true, tradersOnly: true },
  { href: "/how-it-works", label: "How it works", section: "how-it-works", tradersOnly: true },
  { href: "/startups", label: "Startups", section: "startups", remember: true },
  { href: "/news", label: "News", remember: true },
  { href: "/leaderboard", label: "Leaderboard", tradersOnly: true },
  { href: "/profile", label: "Profile", signedIn: true, tradersOnly: true },
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
      className="relative z-40 border-b border-hairline bg-page"
      // Stays still while page content transitions underneath.
      style={{ viewTransitionName: "site-header" }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-ink-900"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" aria-label="Senzi home" className="shrink-0 transition-opacity hover:opacity-80">
          <Image src="/senzi-logo-dark.png" alt="Senzi" width={84} height={24} priority className="dark:hidden" />
          <Image src="/senzi-logo.png" alt="Senzi" width={84} height={24} priority className="hidden dark:block" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <Suspense fallback={<NavLinks pathname={null} />}>
            <RoutedNavLinks />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Open search"
            className="mr-1 hidden h-9 items-center gap-2 rounded-full border border-hairline bg-surface pl-3 pr-2 text-sm text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900 md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden pr-4 lg:inline">Search</span>
            <ShortcutHint className="hidden rounded-md bg-ink-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-700 lg:inline" />
          </button>
          <LanguageMenu />
          <AccessibilityMenu />
          <ThemeToggle />
          <NotificationsBell />
          <div className="ml-1 hidden md:block">
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
      { rootMargin: "0px 0px -40% 0px", threshold: [0, 0.15, 0.4] },
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
  "relative rounded-full px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors duration-200 hover:text-ink-900";

function NavLinks({ pathname }: { pathname: string | null }) {
  const onHome = pathname === "/";
  const section = useActiveSection(onHome);
  const { isSignedIn } = useAuth();
  const showTrading = useShowTradingUi();
  return (
    <>
      {links.filter((link) => (!link.signedIn || isSignedIn) && (!link.tradersOnly || showTrading)).map((link) => {
        const active = onHome
          ? link.section !== undefined && link.section === section
          : !link.exact && isActive(pathname, link.href);
        return <NavLink key={link.href} link={link} active={active} inPage={onHome && active} />;
      })}
      <VcMenu className={linkClass} pathname={pathname} />
    </>
  );
}

function NavLink({ link, active, inPage }: { link: NavItem; active: boolean; inPage: boolean }) {
  const remembered = useRememberedHref(link.href);
  return (
    <Link
      href={link.remember ? remembered : link.href}
      aria-current={active ? (inPage ? "location" : "page") : undefined}
      className={cn(linkClass, active && "text-ink-900")}
    >
      {link.label}
      {active && (
        <span aria-hidden className="absolute inset-x-3 -bottom-[17px] h-0.5 animate-[grow-x_220ms_var(--ease-out-soft)] rounded-full bg-red-500" />
      )}
    </Link>
  );
}
