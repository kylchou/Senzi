"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Building2, Home, LineChart, Pencil, Search, User } from "lucide-react";
import { cn } from "./cn";
import { openCommandPalette } from "./CommandPalette";
import { useRememberedHref } from "./remembered-filters";

const tabs = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/markets", label: "Markets", Icon: LineChart, exact: false },
  { href: "/startups", label: "Startups", Icon: Building2, exact: false },
  // Opens the homepage walkthrough (see HowItWorksTutorial).
  { href: "/#tutorial", label: "Learn", Icon: Pencil, exact: true },
];

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
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-full bg-night px-2 text-mist-300 shadow-[0_14px_36px_-14px_rgb(0_0_0/0.6)] ring-1 ring-white/5 md:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch">
          <Suspense fallback={<Tabs pathname={null} />}>
            <RoutedTabs />
          </Suspense>
          <button type="button" onClick={openCommandPalette} className={cn(itemClass, "hover:text-white")}>
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
  return tabs.map((tab) => <Tab key={tab.href} tab={tab} pathname={pathname} />);
}

function Tab({ tab: { href, label, Icon, exact }, pathname }: { tab: (typeof tabs)[number]; pathname: string | null }) {
  const remembered = useRememberedHref(href);
  const active =
    pathname !== null && (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <Link
      href={exact ? href : remembered}
      aria-current={active ? "page" : undefined}
      className={cn(itemClass, active ? "text-white" : "hover:text-white")}
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
      <div className={itemClass}>
        <UserButton />
        <span>Account</span>
      </div>
    );
  }
  return (
    <SignInButton mode="modal">
      <button type="button" className={cn(itemClass, "hover:text-white")}>
        <User className="size-5" aria-hidden />
        Sign in
      </button>
    </SignInButton>
  );
}
