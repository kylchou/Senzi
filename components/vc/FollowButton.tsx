"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { buttonSecondary, errorClass, inputClass } from "./styles";

type Target = { type: "STUDY"; studyId: string } | { type: "STARTUP"; startupId: string };

/** Adds a study or startup to one of the firm's watchlists. */
export function FollowButton({
  target,
  watchlists,
  label = "Add to watchlist",
}: {
  target: Target;
  watchlists: { id: string; name: string }[];
  label?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [watchlistId, setWatchlistId] = useState(watchlists[0]?.id ?? "");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (watchlists.length === 0) {
    return (
      <a href="/vc/watchlists" className="text-sm text-slate-600 underline dark:text-slate-300">
        Create a watchlist to follow this
      </a>
    );
  }

  async function follow() {
    setState("saving");
    setError(null);
    try {
      await vcFetch(`/api/vc/watchlists/${watchlistId}/items`, { method: "POST", json: target });
      setState("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Could not add to watchlist");
      setState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {watchlists.length > 1 && (
        <>
          <label htmlFor={id} className="sr-only">
            Watchlist
          </label>
          <select id={id} className={`${inputClass} w-auto`} value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)}>
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="button" className={buttonSecondary} onClick={follow} disabled={state !== "idle"}>
        {state === "saving" ? "Adding…" : state === "done" ? "Following ✓" : label}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
