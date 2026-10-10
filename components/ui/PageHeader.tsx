import { Container } from "./Container";

/** Page title area: no band, generous space, and a faint dot grid in the corner. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="dot-grid pointer-events-none absolute right-0 top-0 hidden h-56 w-80 text-ink-300 [mask-image:radial-gradient(ellipse_at_top_right,black_20%,transparent_70%)] sm:block"
      />
      <Container className="relative pb-2 pt-10 sm:pt-14">
        <h1 className="text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-ink-500">{subtitle}</p>}
        {children && <div className="mt-8">{children}</div>}
      </Container>
    </div>
  );
}
