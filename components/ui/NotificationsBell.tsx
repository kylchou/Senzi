"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import { formatRelative } from "@/lib/market-view/format";
import { cn } from "./cn";

/** Shape of a row from GET /api/users/me/notifications (Kyler's API). */
interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;
const COUNT_CAP = 20;

async function fetchNotifications(unreadOnly: boolean, limit: number): Promise<NotificationItem[]> {
  const response = await fetch(`/api/users/me/notifications?unread=${unreadOnly}&limit=${limit}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { data?: NotificationItem[] } | null;
  return Array.isArray(body?.data) ? body.data : [];
}

async function markAllRead() {
  await fetch("/api/users/me/notifications", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: "all" }),
  }).catch(() => undefined);
}

/** Draws a red dot on the browser tab icon while there are unread notifications. */
function useFaviconBadge(show: boolean) {
  const original = useRef<string | null>(null);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    original.current ??= link.href;
    if (!show) {
      link.href = original.current;
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, 64, 64);
      context.beginPath();
      context.arc(50, 14, 13, 0, Math.PI * 2);
      context.fillStyle = "#ff2c2c";
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = "#ffffff";
      context.stroke();
      link.href = canvas.toDataURL("image/png");
    };
    image.src = original.current;
  }, [show]);
}

/** Bell with an unread count and a short list of recent notifications. */
export function NotificationsBell() {
  const { isLoaded, isSignedIn } = useAuth();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const signedIn = isLoaded && isSignedIn;

  const refreshCount = useCallback(async () => {
    const rows = await fetchNotifications(true, COUNT_CAP);
    setUnread(rows.length);
  }, []);

  useFaviconBadge(signedIn === true && unread > 0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const tick = () => {
      if (document.visibilityState === "visible" && !cancelled) void refreshCount();
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [signedIn, refreshCount]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!signedIn) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setItems(await fetchNotifications(false, 8));
  }

  async function readAll() {
    await markAllRead();
    setUnread(0);
    setItems((list) => list?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ?? null);
  }

  const label = unread === 0 ? "Notifications" : `Notifications, ${unread >= COUNT_CAP ? `${COUNT_CAP}+` : unread} unread`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="relative rounded-full p-2 text-mist-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 animate-[pop-in_200ms_var(--ease-out-soft)] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-night">
            {unread >= COUNT_CAP ? `${COUNT_CAP}+` : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right animate-[pop-in_160ms_var(--ease-out-soft)] overflow-hidden rounded-xl border border-ink-200 bg-surface text-ink-900 shadow-[var(--shadow-lift)]"
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="font-display text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-xs font-semibold text-red-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items === null ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">Loading</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">You are all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-ink-100 overflow-auto">
              {items.map((item) => {
                const content = (
                  <>
                    <span
                      aria-hidden
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-red-500")}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.title}</span>
                      {item.body && <span className="mt-0.5 block text-xs text-ink-600">{item.body}</span>}
                      <span className="mt-1 block text-[11px] text-ink-500">{formatRelative(item.createdAt)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {item.link?.startsWith("/") ? (
                      <Link
                        href={item.link}
                        onClick={() => setOpen(false)}
                        className="flex gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
