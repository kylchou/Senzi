"use client";

import { useRouter } from "next/navigation";
import { StartupPicker } from "./StartupPicker";

/** Startup search: picking one opens its company page. */
export function StartupSearch() {
  const router = useRouter();
  return (
    <StartupPicker
      value={null}
      onChange={(startup) => {
        if (startup) router.push(`/vc/companies/${encodeURIComponent(startup.id)}`);
      }}
    />
  );
}
