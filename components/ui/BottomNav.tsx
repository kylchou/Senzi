"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { Briefcase, Building2, Compass, Home, Pencil, Search, User } from "lucide-react";
import { cn } from "./cn";
import { openCommandPalette } from "./CommandPalette";
import { useRememberedHref } from "./remembered-filters";
import { useIsVcAccount } from "./account-type";
import { hasVcAccess, useVcWorkspace } from "./vc-workspace";

const tabs = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/markets", label: "Markets", Icon: Compass, exact: false },
  { href: "/startups", label: "Startups", Icon: Building2, exact: false },
  { href: "/how-it-works", label: "Learn", Icon: Pencil, exact: false },
];

/** For firm members the Learn slot opens their Intelligence workspace instead, keeping the bar at six items. */
const intelligenceTab = { href: "/vc", label: "Intelligence", Icon: Briefcase, exact: false };

const itemClass =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[color,transform] duration-150 active:scale-90";

/** Thumb-reachable tab bar on small screens. Hidden from md up. */
export function BottomNav() {
  return (
    <>
      {/* Spacer so the fixed bar never covers the end of the page. */}
      <div aria-hidden className="h-24 md:hidden" />
      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-full border border-hairline bg-surface/90 px-2 text-ink-500 shadow-[var(--shadow-lift)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch">
          <Suspense fallback={<Tabs pathname={null} />}>
            <RoutedTabs />
          </Suspense>
          <button type="button" onClick={openCommandPalette} className={cn(itemClass, "hover:text-ink-900")}>
            <Search className="size-5" aria-hidden />
            Search
          </button>
          <AccountTab />
        </div>
      </nav>
    </>
  );
}

function RoutedTabs() {
  return <Tabs pathname={usePathname()} />;
}

function Tabs({ pathname }: { pathname: string | null }) {
  const vc = hasVcAccess(useVcWorkspace());
  // VC accounts don't trade, so they don't get the Markets tab.
  const isVcAccount = useIsVcAccount();
  const shown = (vc ? tabs.map((tab) => (tab.href === "/how-it-works" ? intelligenceTab : tab)) : tabs).filter(
    (tab) => !(isVcAccount && tab.href === "/markets"),
  );
  return shown.map((tab) => <Tab key={tab.href} tab={tab} pathname={pathname} />);
}

function Tab({ tab: { href, label, Icon, exact }, pathname }: { tab: (typeof tabs)[number]; pathname: string | null }) {
  const remembered = useRememberedHref(href);
  const active =
    pathname !== null && (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <Link
      href={exact ? href : remembered}
      aria-current={active ? "page" : undefined}
      className={cn(itemClass, active ? "text-ink-900" : "hover:text-ink-900")}
    >
      <span className="relative">
        <Icon className="size-5" aria-hidden />
        {active && (
          <span aria-hidden className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-red-500" />
        )}
      </span>
      {label}
    </Link>
  );
}

function AccountTab() {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) {
    return (
      <Link href="/profile" className={cn(itemClass, "hover:text-ink-900")}>
        <User className="size-5" aria-hidden />
        Profile
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <button type="button" className={cn(itemClass, "hover:text-ink-900")}>
        <User className="size-5" aria-hidden />
        Sign in
      </button>
    </SignInButton>
  );
}
