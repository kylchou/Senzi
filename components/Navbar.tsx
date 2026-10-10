"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { AuthControls } from "@/components/ui/AuthControls";
import { Container } from "@/components/ui/Container";
import { ThemeSegmented, ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/components/ui/cn";

const links = [
  { href: "/markets", label: "Markets" },
  { href: "/startups", label: "Startups" },
];

function isActive(pathname: string | null, href: string) {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
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

function NavbarView({ pathname }: { pathname: string | null }) {
  // Menu belongs to the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = pathname !== null && openOn === pathname;

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
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={cn(
                "relative rounded-full px-3 py-1.5 text-sm font-medium text-mist-300 transition-colors hover:text-white",
                isActive(pathname, link.href) &&
                  "text-white after:absolute after:inset-x-3 after:-bottom-[15px] after:h-0.5 after:bg-red-500",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link
            href="/search"
            aria-label="Search"
            className="rounded-full p-2 text-mist-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Search className="size-5" aria-hidden />
          </Link>
          <ThemeToggle />
          <AuthControls />
        </div>

        <button
          type="button"
          className="ml-auto rounded-full p-2 text-mist-300 hover:bg-white/10 hover:text-white md:hidden"
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
            {[...links, { href: "/search", label: "Search" }].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm font-medium text-mist-300 hover:bg-white/5 hover:text-white",
                  isActive(pathname, link.href) && "bg-white/5 text-white",
                )}
              >
                {link.label}
              </Link>
            ))}
            <ThemeSegmented className="mt-2" />
            <AuthControls variant="accent" className="mt-2 w-full" />
          </Container>
        </nav>
      )}
    </header>
  );
}
