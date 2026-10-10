"use client";

import { useActionState } from "react";
import { ImageUp, KeyRound } from "lucide-react";
import type { VerifyFormState } from "@/app/verify/[slug]/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

type Action = (state: VerifyFormState, fd: FormData) => Promise<VerifyFormState>;
const initial: VerifyFormState = { ok: false, message: null };

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  ) : null;
}

/** Instant: a code the startup gave its users. */
export function AccessCodeForm({ action, startupName }: { action: Action; startupName: string }) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="surface-card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-red-700" aria-hidden />
        <h2 className="font-display text-lg font-semibold text-ink-900">Enter an access code</h2>
      </div>
      <p className="text-sm text-ink-600">
        If {startupName} gave you a Senzi access code, enter it here. You&apos;re verified right away.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="access-code">Access code</Label>
        <Input id="access-code" name="code" required autoComplete="off" autoCapitalize="characters" placeholder="e.g. STRIPE-7KQ2-X9WD" />
      </div>
      <ErrorLine message={state.message} />
      <Button type="submit" variant="accent" disabled={pending} className="self-start">
        {pending ? "Checking…" : "Verify with code"}
      </Button>
    </form>
  );
}

/** Reviewed by an admin: a screenshot of their account. */
export function ScreenshotForm({ action, startupName }: { action: Action; startupName: string }) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="surface-card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <ImageUp className="size-5 text-red-700" aria-hidden />
        <h2 className="font-display text-lg font-semibold text-ink-900">Send a screenshot</h2>
      </div>
      <p className="text-sm text-ink-600">
        Upload a screenshot of your {startupName} account, like your dashboard or a recent invoice. Hide anything private first.
        A Senzi admin checks it, usually within a day.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="screenshot">Screenshot (PNG, JPEG, or WebP, up to 3 MB)</Label>
        <input
          id="screenshot"
          name="screenshot"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp"
          className="text-sm text-ink-700 file:mr-3 file:rounded-full file:border file:border-hairline file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-900"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="screenshot-note">Note (optional)</Label>
        <textarea
          id="screenshot-note"
          name="note"
          rows={2}
          maxLength={1000}
          className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-[var(--shadow-card)] focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        />
      </div>
      <ErrorLine message={state.message} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Uploading…" : "Send for review"}
      </Button>
    </form>
  );
}
