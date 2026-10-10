import { Container } from "./Container";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-ink-200 bg-ink-50">
      <Container className="py-10 sm:py-12">
        <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-600">{subtitle}</p>}
        {children && <div className="mt-6">{children}</div>}
      </Container>
    </div>
  );
}
