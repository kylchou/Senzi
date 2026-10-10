"use client";

import Link from "next/link";
import { useShowTradingUi } from "./account-type";

const links = [
  { href: "/markets", label: "Markets", tradersOnly: true },
  { href: "/startups", label: "Startups" },
  { href: "/news", label: "News" },
  { href: "/search", label: "Search" },
];

/** Footer navigation. VC accounts don't trade, so they don't get the Markets link. */
export function FooterLinks() {
  const showTrading = useShowTradingUi();
  return (
    <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
      {links
        .filter((link) => !link.tradersOnly || showTrading)
        .map((link) => (
          <Link key={link.href} href={link.href} className="transition-colors hover:text-ink-900">
            {link.label}
          </Link>
        ))}
    </nav>
  );
}
