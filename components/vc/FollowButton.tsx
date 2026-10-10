"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { buttonPrimary, buttonSecondary, errorClass } from "./styles";

type Target = { type: "STUDY"; studyId: string } | { type: "STARTUP"; startupId: string };

/** Follows or unfollows a startup or study for the whole firm. There are no lists to pick. */
export function FollowButton({ target, following: initial }: { target: Target; following: boolean }) {
  const router = useRouter();
  const [following, setFollowing] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      await vcFetch("/api/vc/follows", { method: following ? "DELETE" : "POST", json: target });
      setFollowing(!following);
      router.refresh();
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Couldn't update your watchlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={following ? buttonSecondary : buttonPrimary}
        onClick={toggle}
        disabled={saving}
        aria-pressed={following}
      >
        {saving ? "Saving…" : following ? "Following ✓" : "Follow"}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
