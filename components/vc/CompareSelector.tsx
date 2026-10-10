"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_COMPARE, MIN_COMPARE } from "@/lib/vc/compare";
import { StartupPicker } from "./StartupPicker";

/** Picks 2–4 startups; the selection lives in the URL (?ids=a,b) so it can be shared. */
export function CompareSelector({ selected }: { selected: { id: string; name: string }[] }) {
  const router = useRouter();
  const [picker, setPicker] = useState<{ id: string; name: string } | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const go = (ids: string[]) => router.push(ids.length ? `/vc/compare?ids=${ids.map(encodeURIComponent).join(",")}` : "/vc/compare");
  const ids = selected.map((s) => s.id);

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label="Startups being compared">
        {selected.map((s) => (
          <li key={s.id} className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm dark:bg-slate-800">
            {s.name}
            <button
              type="button"
              className="rounded-full px-2 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              aria-label={`Remove ${s.name}`}
              onClick={() => go(ids.filter((id) => id !== s.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {selected.length < MAX_COMPARE ? (
        <div className="max-w-sm">
          <StartupPicker
            key={pickerKey}
            value={picker}
            onChange={(s) => {
              setPicker(s);
              if (s && !ids.includes(s.id)) {
                setPickerKey((k) => k + 1);
                setPicker(null);
                go([...ids, s.id]);
              }
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-500">Up to {MAX_COMPARE} startups. Remove one to add another.</p>
      )}
      {selected.length < MIN_COMPARE && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Add at least {MIN_COMPARE} startups to compare.</p>
      )}
    </div>
  );
}
