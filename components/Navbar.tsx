"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { openCommandPalette, ShortcutHint } from "@/components/ui/CommandPalette";
import { Container } from "@/components/ui/Container";
import { NotificationsBell } from "@/components/ui/NotificationsBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/components/ui/cn";
import { useRememberedHref } from "@/components/ui/remembered-filters";

const links = [
  { href: "/markets", label: "Markets" },
  { href: "/startups", label: "Startups" },
  { href: "/news", label: "News" },
];

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
      className="sticky top-0 z-40 border-b border-white/5 bg-night text-white"
      // Stays still while page content transitions underneath.
      style={{ viewTransitionName: "site-header" }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-ink-900"
      >
        Skip to content
      </a>
      <Container className="flex h-16 items-center gap-8">
        <Link href="/" aria-label="Senzi home" className="shrink-0">
          <Image src="/senzi-logo.png" alt="Senzi" width={77} height={22} priority />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <Suspense fallback={<NavLinks pathname={null} />}>
            <RoutedNavLinks />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3 pr-2 text-sm text-mist-300 transition-colors hover:border-white/20 hover:text-white md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="pr-6">Search</span>
            <ShortcutHint className="rounded border border-white/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-mist-400" />
          </button>
          <ThemeToggle />
          <NotificationsBell />
          <div className="hidden md:block">
            <AuthControls />
          </div>
        </div>
      </Container>
    </header>
  );
}

function RoutedNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return links.map((link) => <NavLink key={link.href} link={link} pathname={pathname} />);
}

/** Opens the listing with its last-used filters. */
function NavLink({ link, pathname }: { link: (typeof links)[number]; pathname: string | null }) {
  const href = useRememberedHref(link.href);
  return (
    <Link
      href={href}
      aria-current={isActive(pathname, link.href) ? "page" : undefined}
      className={cn(
        "relative rounded-full px-3 py-1.5 text-sm font-medium text-mist-300 transition-colors hover:text-white",
        isActive(pathname, link.href) &&
          "text-white after:absolute after:inset-x-3 after:-bottom-[15px] after:h-0.5 after:bg-red-500",
      )}
    >
      {link.label}
    </Link>
  );
}
