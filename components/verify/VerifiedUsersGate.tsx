import { ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

/** Shown instead of the forecast panel on a verified-users market the viewer hasn't unlocked. */
export function VerifiedUsersGate({ startup, marketSlug }: { startup: { name: string; slug: string }; marketSlug: string }) {
  return (
    <div className="surface-card p-6">
      <ShieldCheck className="size-7 text-red-700" aria-hidden />
      <h2 className="mt-3 font-display text-lg font-semibold text-ink-900">For verified {startup.name} users</h2>
      <p className="mt-2 text-sm text-ink-600">
        Only people who show they use {startup.name} can trade on this market. Anyone can follow along.
      </p>
      <ButtonLink
        href={`/verify/${startup.slug}?next=${encodeURIComponent(`/markets/${marketSlug}`)}`}
        variant="accent"
        className="mt-5 w-full"
      >
        Verify you use {startup.name}
      </ButtonLink>
    </div>
  );
}

/** Small note above the forecast panel once they've unlocked it. */
export function VerifiedUserNote({ startupName }: { startupName: string }) {
  return (
    <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <ShieldCheck className="size-4" aria-hidden /> You&apos;re a verified {startupName} user
    </p>
  );
}
