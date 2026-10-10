"use client";

import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { formatDateTime } from "@/lib/vc/format";
import type { StudyNote } from "@/lib/vc/types";
import { buttonPrimary, errorClass, inputClass } from "./styles";

/** Private firm notes. Rendered only for users with private access to the study. */
export function NotesPanel({
  studyId,
  initialNotes,
  canWrite,
  currentUserId,
  authors,
}: {
  studyId: string;
  initialNotes: StudyNote[];
  canWrite: boolean;
  currentUserId: string;
  authors: Record<string, string>;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const note = await vcFetch<StudyNote>(`/api/studies/${studyId}/notes`, { method: "POST", json: { body } });
      setNotes((n) => [note, ...n]);
      setBody("");
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this note?")) return;
    try {
      await vcFetch(`/api/studies/${studyId}/notes/${id}`, { method: "DELETE" });
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Could not delete note");
    }
  }

  return (
    <div className="space-y-3">
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add();
          }}
          className="space-y-2"
        >
          <label htmlFor="note-body" className="sr-only">
            New note
          </label>
          <textarea
            id="note-body"
            rows={3}
            className={inputClass}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a private note for your firm…"
            maxLength={10000}
          />
          <button type="submit" className={buttonPrimary} disabled={saving || !body.trim()}>
            {saving ? "Saving…" : "Add note"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900">
              <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">{n.body}</p>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {authors[n.authorId] ?? "Team member"} · {formatDateTime(n.createdAt)}
                </span>
                {canWrite && n.authorId === currentUserId && (
                  <button type="button" onClick={() => remove(n.id)} className="text-rose-700 hover:underline dark:text-rose-300">
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
