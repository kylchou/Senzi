"use client";

import { useRouter } from "next/navigation";
import { StartupPicker } from "./StartupPicker";

/** Search box for the watchlist page: picking a startup opens its signals and open markets. */
export function StartupSearch() {
  const router = useRouter();
  return (
    <StartupPicker
      value={null}
      onChange={(startup) => {
        if (startup) router.push(`/vc/watchlists?startup=${encodeURIComponent(startup.id)}`);
      }}
    />
  );
}
