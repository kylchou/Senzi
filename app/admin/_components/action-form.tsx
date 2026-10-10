"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/admin/actions";

const initialState: ActionState = { ok: false, message: null };

/** A form wired to a server action, showing its success or validation errors. */
export function ActionForm({
  action,
  submitLabel,
  children,
  tone = "default",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  tone?: "default" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const buttonTone =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-500 text-white"
      : "bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-100 dark:text-zinc-900";

  return (
    <form action={formAction} className="space-y-4">
      {children}
      {state.message && (
        <div
          role={state.ok ? "status" : "alert"}
          className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
        >
          <p>{state.message}</p>
          {state.issues && state.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {issue.path ? <strong>{issue.path}: </strong> : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${buttonTone}`}
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
