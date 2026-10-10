"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { updateProfileAction, type ProfileFormState } from "@/app/profile/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toaster";

const initial: ProfileFormState = { ok: false, message: null };

/** Inline form for name, username, and bio. */
export function EditProfile({ displayName, username, bio }: { displayName: string; username: string | null; bio: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const toggle = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) form.current?.querySelector("input")?.focus();
  }, [open]);

  // Close on save and hand focus back to the button.
  useEffect(() => {
    if (!state.ok) return;
    toast(state.message ?? "Profile saved.");
    const timer = window.setTimeout(() => {
      setOpen(false);
      toggle.current?.querySelector("button")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state]);

  const v = state.values ?? { displayName, username: username ?? "", bio: bio ?? "" };
  const error = (name: keyof NonNullable<ProfileFormState["fieldErrors"]>) => state.fieldErrors?.[name];

  return (
    <div ref={toggle}>
      <Button variant="outline" size="sm" aria-expanded={open} aria-controls={formId} onClick={() => setOpen((o) => !o)}>
        <Pencil className="size-3.5" aria-hidden /> {open ? "Close" : "Edit profile"}
      </Button>
      {open && (
        <form ref={form} id={formId} action={action} className="surface-card mt-3 grid max-w-xl gap-4 p-5" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <Field label="Display name" name="displayName" error={error("displayName")}>
            <Input id="profile-displayName" name="displayName" defaultValue={v.displayName} maxLength={80} required aria-invalid={!!error("displayName")} aria-describedby="profile-displayName-error" />
          </Field>
          <Field label="Username" name="username" error={error("username")} hint="Optional. Lowercase letters, numbers, and underscores.">
            <Input id="profile-username" name="username" defaultValue={v.username} maxLength={30} autoComplete="username" aria-invalid={!!error("username")} aria-describedby="profile-username-error" />
          </Field>
          <Field label="Bio" name="bio" error={error("bio")}>
            <textarea
              id="profile-bio"
              name="bio"
              rows={3}
              maxLength={500}
              defaultValue={v.bio}
              aria-invalid={!!error("bio")}
              aria-describedby="profile-bio-error"
              className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-[var(--shadow-card)] placeholder:text-ink-500 focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
            />
          </Field>
          {state.message && !state.ok && (
            <p role="alert" className="text-sm text-red-700">
              {state.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="accent" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`profile-${name}`}>{label}</Label>
      {children}
      <p id={`profile-${name}-error`} className={error ? "text-xs text-red-700" : "text-xs text-ink-500"}>
        {error ?? hint}
      </p>
    </div>
  );
}
