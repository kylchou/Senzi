import Image from "next/image";
import { Container } from "./Container";
import { FooterLinks } from "./FooterLinks";

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
        <FooterLinks />
      </Container>
    </footer>
  );
}
