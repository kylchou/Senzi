import Image from "next/image";
import Link from "next/link";
import { Container } from "./Container";

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-night text-mist-300">
      <Container className="flex flex-col gap-8 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm space-y-3">
          <Image src="/senzi-logo.png" alt="Senzi" width={88} height={25} />
          <p className="text-sm leading-relaxed">
            Virtual credits only. Forecasts are research signals, not guarantees or investment advice.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-8 text-sm">
          <Link href="/markets" className="hover:text-white">Markets</Link>
          <Link href="/startups" className="hover:text-white">Startups</Link>
          <Link href="/news" className="hover:text-white">News</Link>
          <Link href="/search" className="hover:text-white">Search</Link>
        </nav>
      </Container>
    </footer>
  );
}
