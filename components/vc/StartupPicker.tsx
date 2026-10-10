"use client";

import { useEffect, useId, useState } from "react";
import { vcFetch } from "@/lib/vc/client";
import type { StartupSummary } from "@/lib/vc/types";
import { errorClass, inputClass, labelClass } from "./styles";

/** Accessible combobox that searches startups via /api/vc/startups. */
export function StartupPicker({
  value,
  onChange,
  error,
}: {
  value: { id: string; name: string } | null;
  onChange: (startup: { id: string; name: string } | null) => void;
  error?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<StartupSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open || query.trim().length < 2 || query === value?.name) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await vcFetch<StartupSummary[]>(`/api/vc/startups?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        setResults(data);
        setActive(0);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open, value?.name]);

  function select(s: StartupSummary) {
    onChange({ id: s.id, name: s.name });
    setQuery(s.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className={labelClass}>
        Startup
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        autoComplete="off"
        value={query}
        placeholder="Search startups by name"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            select(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`${inputClass} mt-1`}
      />
      {open && query.trim().length >= 2 && !value && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {loading && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {!loading && results.length === 0 && <li className="px-3 py-2 text-slate-500">No startups found</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-slate-100 dark:bg-slate-800" : ""}`}
            >
              <span className="font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
              {s.industry && <span className="ml-2 text-xs text-slate-500">{s.industry}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-err`} className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
