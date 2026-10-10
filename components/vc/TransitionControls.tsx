"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { TRANSITIONS, type StudyAction } from "@/lib/vc/lifecycle";
import { buttonDanger, buttonPrimary, buttonSecondary, errorClass, inputClass, labelClass } from "./styles";

const DANGER: StudyAction[] = ["reject", "cancel"];
const PRIMARY: StudyAction[] = ["submit", "approve", "open"];

const CONFIRM: Partial<Record<StudyAction, string>> = {
  submit: "Submit this study for platform review? It can no longer be edited unless withdrawn.",
  open: "Open forecasting? This creates the market and makes the question visible according to its visibility setting.",
  close: "Close forecasting now, before the deadline?",
};

/** Lifecycle buttons. The server decides which actions are allowed; this only renders them. */
export function TransitionControls({
  studyId,
  version,
  allowedActions,
}: {
  studyId: string;
  version: number;
  allowedActions: StudyAction[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<StudyAction | null>(null);
  const [reasonFor, setReasonFor] = useState<StudyAction | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const actions = allowedActions.filter((a) => a !== "resolve");
  if (actions.length === 0) return null;

  async function run(action: StudyAction, withReason?: string) {
    if (!withReason && CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
    setPending(action);
    setError(null);
    try {
      await vcFetch(`/api/studies/${studyId}/transitions`, {
        method: "POST",
        json: { action, expectedVersion: version, ...(withReason && { reason: withReason }) },
      });
      setReasonFor(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const rule = TRANSITIONS[action];
          const cls = DANGER.includes(action) ? buttonDanger : PRIMARY.includes(action) ? buttonPrimary : buttonSecondary;
          return (
            <button
              key={action}
              type="button"
              className={cls}
              disabled={pending !== null}
              aria-expanded={rule.requiresReason ? reasonFor === action : undefined}
              onClick={() => (rule.requiresReason ? setReasonFor(reasonFor === action ? null : action) : run(action))}
            >
              {pending === action ? "Working…" : rule.label}
            </button>
          );
        })}
      </div>

      {reasonFor && (
        <form
          className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) run(reasonFor, reason.trim());
          }}
        >
          <label htmlFor="transition-reason" className={labelClass}>
            Reason ({TRANSITIONS[reasonFor].label.toLowerCase()})
          </label>
          <textarea
            id="transition-reason"
            rows={3}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
          />
          <div className="flex gap-2">
            <button type="submit" className={buttonDanger} disabled={pending !== null || reason.trim().length < 3}>
              Confirm {TRANSITIONS[reasonFor].label.toLowerCase()}
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setReasonFor(null)}>
              Back
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
