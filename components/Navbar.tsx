"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { openCommandPalette, ShortcutHint } from "@/components/ui/CommandPalette";
import { NotificationsBell } from "@/components/ui/NotificationsBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { VcLink } from "@/components/ui/VcLink";
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
      </div>
    </header>
  );
}

function RoutedNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

const linkClass =
  "rounded-full px-3.5 py-1.5 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-white/5 hover:text-white";

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <>
      {links.map((link) => (
        <NavLink key={link.href} link={link} pathname={pathname} />
      ))}
      <VcLink active={isActive(pathname, "/vc")} className={linkClass} />
    </>
  );
}

/** Opens the listing with its last-used filters. */
function NavLink({ link, pathname }: { link: (typeof links)[number]; pathname: string | null }) {
  const href = useRememberedHref(link.href);
  return (
    <Link
      href={href}
      aria-current={isActive(pathname, link.href) ? "page" : undefined}
      className={cn(linkClass, isActive(pathname, link.href) && "bg-white/10 text-white")}
    >
      {link.label}
    </Link>
  );
}
