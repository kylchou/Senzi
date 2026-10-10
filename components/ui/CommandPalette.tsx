"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Building2, Clock, CornerDownLeft, LineChart, Search, X } from "lucide-react";
import { formatShare } from "@/lib/market-view/format";
import { cn } from "./cn";

/* Open state lives in a tiny store so any button can open the palette. */
let isOpen = false;
const listeners = new Set<() => void>();
const setOpenState = (value: boolean) => {
  isOpen = value;
  listeners.forEach((listener) => listener());
};
export const openCommandPalette = () => setOpenState(true);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const RECENT_KEY = "senzi-recent-searches";
const readRecent = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
};
const saveRecent = (query: string) => {
  try {
    const next = [query, ...readRecent().filter((value) => value.toLowerCase() !== query.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent searches are a convenience only.
  }
};

interface Item {
  id: string;
  group: "Markets" | "Startups" | "Recent" | "Go to";
  label: string;
  hint?: string;
  href: string;
  query?: string;
}

const QUICK_LINKS: Item[] = [
  { id: "q-markets", group: "Go to", label: "All markets", href: "/markets" },
  { id: "q-closing", group: "Go to", label: "Closing soon", href: "/markets?status=OPEN" },
  { id: "q-active", group: "Go to", label: "Most forecasts", href: "/markets?sort=active" },
  { id: "q-startups", group: "Go to", label: "Startup directory", href: "/startups" },
  { id: "q-news", group: "Go to", label: "News", href: "/news" },
];

type MarketHit = { id: string; slug: string; question: string; startup: { name: string }; allocation: { share: number | null } };
type StartupHit = { slug: string; name: string; industry: string };

/** Command-K search across markets and startups. Mounted once in the app chrome. */
export function CommandPalette() {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ markets: MarketHit[]; startups: StartupHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  // Global shortcut: Cmd+K or Ctrl+K, and "/" when not typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if ((event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpenState(!isOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus management and recent searches when opening.
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      setRecent(readRecent());
      inputRef.current?.focus();
    });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  // Debounced search against the public read APIs.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = `q=${encodeURIComponent(q)}&limit=5`;
        const [markets, startups] = await Promise.all([
          fetch(`/api/markets?${params}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : { data: [] })),
          fetch(`/api/startups?${params}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : { data: [] })),
        ]);
        setHits({ markets: markets.data ?? [], startups: startups.data ?? [] });
        setActiveIndex(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setHits({ markets: [], startups: [] });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const trimmed = query.trim();
  const items = useMemo<Item[]>(() => {
    if (trimmed.length < 2) {
      return [
        ...recent.map((value, index) => ({
          id: `r-${index}`,
          group: "Recent" as const,
          label: value,
          href: `/search?q=${encodeURIComponent(value)}`,
          query: value,
        })),
        ...QUICK_LINKS,
      ];
    }
    if (!hits) return [];
    return [
      ...hits.markets.map((market) => ({
        id: `m-${market.id}`,
        group: "Markets" as const,
        label: market.question,
        hint: `${market.startup.name} · ${formatShare(market.allocation.share)} YES`,
        href: `/markets/${market.slug}`,
      })),
      ...hits.startups.map((startup) => ({
        id: `s-${startup.slug}`,
        group: "Startups" as const,
        label: startup.name,
        hint: startup.industry,
        href: `/startups/${startup.slug}`,
      })),
      {
        id: "all",
        group: "Go to" as const,
        label: `See all results for "${trimmed}"`,
        href: `/search?q=${encodeURIComponent(trimmed)}`,
      },
    ];
  }, [trimmed, hits, recent]);

  if (!open) return null;

  function close() {
    setOpenState(false);
    setQuery("");
    setHits(null);
    setActiveIndex(0);
  }

  function go(item: Item) {
    const remembered = item.query ?? (trimmed.length >= 2 ? trimmed : null);
    if (remembered) saveRecent(remembered);
    close();
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) go(item);
      else if (trimmed) go({ id: "enter", group: "Go to", label: trimmed, href: `/search?q=${encodeURIComponent(trimmed)}` });
    }
  }

  const groups = ["Recent", "Markets", "Startups", "Go to"] as const;
  const iconFor = { Recent: Clock, Markets: LineChart, Startups: Building2, "Go to": ArrowRight };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close search"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 animate-[vt-fade_150ms_ease-out] bg-ink-950/40 backdrop-blur-sm dark:bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search markets and startups"
        className="relative w-full max-w-xl animate-[pop-in_180ms_var(--ease-out-soft)] overflow-hidden rounded-2xl border border-ink-200 bg-surface text-ink-900 shadow-[var(--shadow-lift)]"
      >
        <div className="flex items-center gap-3 border-b border-ink-100 px-4">
          <Search className="size-5 shrink-0 text-ink-500" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search markets and startups"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[activeIndex] ? `${listId}-${items[activeIndex].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-500"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setQuery("");
                setHits(null);
                inputRef.current?.focus();
              }}
              className="rounded-full p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div id={listId} role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {trimmed.length >= 2 && loading && !hits && <p className="px-3 py-6 text-center text-sm text-ink-500">Searching</p>}
          {trimmed.length >= 2 && hits && items.length === 1 && (
            <p className="px-3 pb-2 pt-4 text-center text-sm text-ink-500">No markets or startups match.</p>
          )}
          {groups.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (!groupItems.length) return null;
            const Icon = iconFor[group];
            return (
              <div key={group} className="pb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">{group}</p>
                {groupItems.map((item) => {
                  const index = items.indexOf(item);
                  const active = index === activeIndex;
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      role="option"
                      aria-selected={active}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                        active ? "bg-ink-100 text-ink-900" : "text-ink-700",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-red-500" : "text-ink-400")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-xs text-ink-500">{item.hint}</span>}
                      </span>
                      {active && <CornerDownLeft className="size-3.5 shrink-0 text-ink-400" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="hidden items-center gap-4 border-t border-ink-100 px-4 py-2.5 text-[11px] text-ink-500 sm:flex">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
          <span>
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

const subscribeNever = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Ctrl K" on the server and on Windows or Linux, "⌘ K" on Apple devices. */
export function ShortcutHint({ className }: { className?: string }) {
  const apple = useSyncExternalStore(subscribeNever, isApple, () => false);
  return <kbd className={className}>{apple ? "⌘ K" : "Ctrl K"}</kbd>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-600">
      {children}
    </kbd>
  );
}
