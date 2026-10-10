"use client";

import { useActionState } from "react";
import { submitVerificationAction, type VerificationFormState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

const initial: VerificationFormState = { ok: false, message: null };

type FieldName = keyof NonNullable<VerificationFormState["fieldErrors"]>;

/** Firm details a Senzi admin checks before turning on VC access. */
export function VcVerificationForm() {
  const [state, action, pending] = useActionState(submitVerificationAction, initial);

  const field = (name: FieldName, label: string, props: React.InputHTMLAttributes<HTMLInputElement>, hint?: string) => {
    const error = state.fieldErrors?.[name];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`vc-${name}`}>{label}</Label>
        <Input id={`vc-${name}`} name={name} aria-invalid={!!error} aria-describedby={`vc-${name}-help`} {...props} />
        <p id={`vc-${name}-help`} className={error ? "text-xs text-red-700" : "text-xs text-ink-500"}>
          {error ?? hint}
        </p>
      </div>
    );
  };

  return (
    <form action={action} className="surface-card grid gap-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firmName", "Firm name", { required: true, maxLength: 120, autoComplete: "organization" })}
        {field("firmWebsite", "Firm website", { required: true, type: "url", placeholder: "https://", autoComplete: "url" })}
        {field("jobTitle", "Your role", { required: true, maxLength: 120, autoComplete: "organization-title" })}
        {field("workEmail", "Work email", { required: true, type: "email", autoComplete: "email" }, "Ideally on the firm's domain.")}
      </div>
      {field("linkedinUrl", "LinkedIn profile", { type: "url", placeholder: "https://www.linkedin.com/in/…" }, "Optional, but it speeds things up.")}
      <div className="grid gap-1.5">
        <Label htmlFor="vc-note">Anything else we should know?</Label>
        <textarea
          id="vc-note"
          name="note"
          rows={3}
          maxLength={1000}
          className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-[var(--shadow-card)] focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        />
      </div>
      {state.message && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
      <Button type="submit" variant="accent" disabled={pending} className="justify-self-start">
        {pending ? "Sending…" : "Send for review"}
      </Button>
    </form>
  );
}
