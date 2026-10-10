"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { WatchlistDetail } from "@/lib/vc/services/watchlists";
import { EmptyState } from "./EmptyState";
import { StartupPicker } from "./StartupPicker";
import { StatusBadge } from "./StatusBadge";
import { buttonDanger, buttonPrimary, errorClass, inputClass, labelClass } from "./styles";

function Share({ value }: { value: number | null | undefined }) {
  return (
    <span className="tabular-nums" title="Community YES credit-allocation share (not a calibrated probability)">
      {formatShare(value, 1)} YES alloc.
    </span>
  );
}

export function WatchlistManager({ watchlists, canEdit }: { watchlists: WatchlistDetail[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickers, setPickers] = useState<Record<string, { id: string; name: string } | null>>({});

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            act(async () => {
              await vcFetch("/api/vc/watchlists", { method: "POST", json: { name: name.trim() } });
              setName("");
            });
          }}
        >
          <div className="min-w-[14rem] flex-1 sm:max-w-sm">
            <label htmlFor="watchlist-name" className={labelClass}>
              New watchlist
            </label>
            <input id="watchlist-name" className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Climate infra" />
          </div>
          <button type="submit" className={buttonPrimary} disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {watchlists.length === 0 && (
        <EmptyState title="No watchlists yet">Create a watchlist to follow startups and studies and receive alerts.</EmptyState>
      )}

      {watchlists.map(({ watchlist, entries }) => (
        <section key={watchlist.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{watchlist.name}</h2>
            {canEdit && (
              <button
                type="button"
                className={buttonDanger}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete watchlist "${watchlist.name}"?`)) {
                    act(() => vcFetch(`/api/vc/watchlists/${watchlist.id}`, { method: "DELETE" }));
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing followed yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {entries.map((entry) => (
                <li key={entry.item.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    {entry.kind === "STUDY" ? (
                      entry.study ? (
                        <>
                          <Link href={`/vc/studies/${entry.study.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                            {entry.study.question}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <StatusBadge status={entry.study.status} />
                            <Share value={entry.estimate?.allocation.yesShare} />
                            <span>{entry.estimate?.participantCount ?? 0} participants</span>
                            <span>Deadline {formatDate(entry.study.deadline)}</span>
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-500">Study no longer available</span>
                      )
                    ) : (
                      <>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {entry.startup?.name ?? "Unknown startup"}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">Startup{entry.startup?.industry ? ` · ${entry.startup.industry}` : ""}</span>
                        {entry.studies.length + entry.markets.length === 0 ? (
                          <p className="mt-0.5 text-xs text-slate-500">No open markets or studies.</p>
                        ) : (
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                            {entry.studies.map((s) => (
                              <li key={s.study.id}>
                                <Link href={`/vc/studies/${s.study.id}`} className="hover:underline">
                                  {s.study.question}
                                </Link>{" "}
                                — <Share value={s.estimate?.allocation.yesShare} />
                              </li>
                            ))}
                            {entry.markets.map((m) => (
                              <li key={m.market.id}>
                                {m.market.question} — <Share value={m.estimate?.allocation.yesShare} />
                                <span className="ml-1 text-slate-400">(public market)</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="text-xs text-rose-700 hover:underline disabled:opacity-50 dark:text-rose-300"
                      disabled={busy}
                      onClick={() => act(() => vcFetch(`/api/vc/watchlists/${watchlist.id}/items/${entry.item.id}`, { method: "DELETE" }))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
              onSubmit={(e) => {
                e.preventDefault();
                const startup = pickers[watchlist.id];
                if (!startup) return;
                act(async () => {
                  await vcFetch(`/api/vc/watchlists/${watchlist.id}/items`, {
                    method: "POST",
                    json: { type: "STARTUP", startupId: startup.id },
                  });
                  setPickers((p) => ({ ...p, [watchlist.id]: null }));
                });
              }}
            >
              <div className="min-w-[14rem] flex-1 sm:max-w-sm">
                <StartupPicker
                  value={pickers[watchlist.id] ?? null}
                  onChange={(s) => setPickers((p) => ({ ...p, [watchlist.id]: s }))}
                />
              </div>
              <button type="submit" className={buttonPrimary} disabled={busy || !pickers[watchlist.id]}>
                Follow startup
              </button>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
