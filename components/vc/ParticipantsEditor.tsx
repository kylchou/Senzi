"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import type { UserSummary } from "@/lib/vc/types";
import { buttonPrimary, errorClass, hintClass, inputClass, labelClass } from "./styles";

/** Manage invited participants for a study (restricted studies require at least one). */
export function ParticipantsEditor({
  studyId,
  participants,
  canManage,
}: {
  studyId: string;
  participants: UserSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(participants);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(userIds: string[], emails: string[] = []) {
    setSaving(true);
    setError(null);
    try {
      const updated = await vcFetch<UserSummary[]>(`/api/studies/${studyId}/participants`, {
        method: "PUT",
        json: { userIds, emails },
      });
      setList(updated);
      setEmail("");
      router.refresh();
    } catch (err) {
      if (err instanceof VcApiError) {
        const unknown = (err.details as { unknownEmails?: string[] } | undefined)?.unknownEmails;
        setError(unknown?.length ? `No Senzi account for: ${unknown.join(", ")}` : err.message);
      } else {
        setError("Could not update participants");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No invited participants.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {list.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{u.name ?? "Unnamed user"}</span>
                {u.email && <span className="ml-2 text-xs text-slate-500">{u.email}</span>}
              </span>
              {canManage && (
                <button
                  type="button"
                  className="text-xs text-rose-700 hover:underline disabled:opacity-50 dark:text-rose-300"
                  disabled={saving}
                  onClick={() => save(list.filter((p) => p.id !== u.id).map((p) => p.id))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) save(list.map((p) => p.id), [email.trim().toLowerCase()]);
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="participant-email" className={labelClass}>
              Invite by email
            </label>
            <input
              id="participant-email"
              type="email"
              className={`${inputClass} mt-1`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="analyst@example.com"
            />
          </div>
          <button type="submit" className={buttonPrimary} disabled={saving || !email.trim()}>
            {saving ? "Saving…" : "Invite"}
          </button>
        </form>
      )}
      <p className={hintClass}>Participants must already have a Senzi account.</p>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
