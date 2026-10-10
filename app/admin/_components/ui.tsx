import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Plain Tailwind building blocks for the internal admin area. The public UI
// (and shadcn/ui setup) belongs to the community frontend.

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

export function ButtonLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
    />
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="mb-4 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700";

export function Field({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input {...props} className={props.type === "checkbox" ? "mr-2" : inputClass} />
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, hint, ...props }: ComponentProps<"textarea"> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea rows={4} {...props} className={inputClass} />
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  options,
  ...props
}: ComponentProps<"select"> & { label: string; options: readonly { value: string; label: string }[] }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <select {...props} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const badgeTone: Record<string, string> = {
  DRAFT: "bg-zinc-200 text-zinc-800",
  OPEN: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-rose-100 text-rose-800",
  PENDING: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-sky-100 text-sky-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
};

export function Badge({ children }: { children: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeTone[children] ?? "bg-zinc-100 text-zinc-700"}`}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
          <tr>
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">{children}</tbody>
      </table>
    </div>
  );
}

/** Dates are shown and edited in UTC so admins in different timezones agree. */
export function formatUtc(date: Date | string | null | undefined) {
  if (!date) return "—";
  return `${new Date(date).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Value for <input type="datetime-local"> interpreted as UTC. */
export function toUtcInputValue(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 16) : "";
}

export function percent(fraction: number) {
  return `${Math.round(fraction * 1000) / 10}%`;
}
