"use client";

import Link from "next/link";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { buttonPrimary, buttonSecondary, errorClass } from "./styles";

/** Export links and "save snapshot". Exports go through the same permission checks as the page. */
export function ReportActions({
  exportBase,
  studyId,
  canSave,
}: {
  
  exportBase: string;
  studyId?: string;
  canSave: boolean;
}) {
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!studyId) return;
    setSaving(true);
    setError(null);
    try {
      setSaved(await vcFetch<{ id: string }>("/api/vc/reports", { method: "POST", json: { studyId } }));
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Could not save report");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <a className={buttonSecondary} href={`${exportBase}?format=markdown`}>
        Download Markdown
      </a>
      <a className={buttonSecondary} href={`${exportBase}?format=csv`}>
        Download CSV
      </a>
      <a className={buttonSecondary} href={`${exportBase}?format=json`} target="_blank" rel="noopener">
        JSON
      </a>
      <button type="button" className={buttonSecondary} onClick={() => window.print()}>
        Print / PDF
      </button>
      {canSave && studyId && !saved && (
        <button type="button" className={buttonPrimary} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save snapshot"}
        </button>
      )}
      {saved && (
        <Link href={`/vc/reports/${saved.id}`} className="text-sm underline">
          Snapshot saved — view
        </Link>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
