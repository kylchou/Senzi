import Image from "next/image";
import Link from "next/link";
import { Container } from "./Container";

const links = [
  { href: "/markets", label: "Markets" },
  { href: "/startups", label: "Startups" },
  { href: "/news", label: "News" },
  { href: "/search", label: "Search" },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-hairline">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Image src="/senzi-logo-dark.png" alt="Senzi" width={77} height={22} className="dark:hidden" />
          <Image src="/senzi-logo.png" alt="Senzi" width={77} height={22} className="hidden dark:block" />
          <p className="max-w-sm text-xs leading-relaxed text-ink-500">
            Virtual credits only. Forecasts are research signals, not guarantees or investment advice.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-ink-900">
              {link.label}
            </Link>
          ))}
        </nav>
      </Container>
    </footer>
  );
}
