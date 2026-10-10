"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { cn } from "../cn";

/**
 * Speaker button that reads a section with the browser's SpeechSynthesis API.
 * Nothing plays without a click. One section speaks at a time. Hidden when the
 * browser has no speech support.
 */

type Playback = { owner: string; paused: boolean } | null;

let playback: Playback = null;
const listeners = new Set<() => void>();

function setPlayback(next: Playback) {
  playback = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

function stop() {
  window.speechSynthesis.cancel();
  setPlayback(null);
}

function speak(owner: string, text: string) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  // Read in the page language, which follows the language menu.
  const lang = document.documentElement.lang || "en";
  utterance.lang = lang;
  const voice = synth.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  utterance.onend = () => playback?.owner === owner && setPlayback(null);
  utterance.onerror = () => playback?.owner === owner && setPlayback(null);
  setPlayback({ owner, paused: false });
  synth.speak(utterance);
}

export function ReadAloud({
  targetId,
  text,
  label,
  className,
}: {
  /** Elements whose visible text is read, in order (so translated text is read in the chosen language). */
  targetId?: string | string[];
  text?: string;
  /** What is read, for the button name: "Read {label} aloud". */
  label: string;
  className?: string;
}) {
  const owner = useId();
  const available = useSyncExternalStore(subscribe, supported, () => false);
  const state = useSyncExternalStore(subscribe, () => playback, () => null);
  const mine = state?.owner === owner ? state : null;

  // Stop if this section leaves the page mid-sentence.
  useEffect(() => () => {
    if (playback?.owner === owner) stop();
  }, [owner]);

  if (!available) return null;

  function start() {
    const ids = targetId === undefined ? [] : Array.isArray(targetId) ? targetId : [targetId];
    const fromPage = ids.map((id) => document.getElementById(id)?.innerText.trim() ?? "").filter(Boolean).join(". ");
    const content = (text ?? fromPage).trim();
    if (content) speak(owner, content);
  }

  function togglePause() {
    if (!mine) return;
    if (mine.paused) window.speechSynthesis.resume();
    else window.speechSynthesis.pause();
    setPlayback({ owner, paused: !mine.paused });
  }

  const button =
    "inline-grid size-8 shrink-0 place-items-center rounded-full text-ink-500 transition-[color,background-color] duration-150 hover:bg-ink-100 hover:text-ink-900";

  if (!mine) {
    return (
      <button type="button" onClick={start} aria-label={`Read ${label} aloud`} title="Read aloud" className={cn(button, className)}>
        <Volume2 className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <span className={cn("inline-flex items-center rounded-full bg-ink-100 p-0.5", className)} role="group" aria-label="Read aloud">
      <button type="button" onClick={togglePause} aria-label={mine.paused ? "Resume" : "Pause"} className={cn(button, "text-ink-900")}>
        {mine.paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
      </button>
      <button type="button" onClick={stop} aria-label="Stop reading" className={cn(button, "text-ink-900")}>
        <Square className="size-3 fill-current" aria-hidden />
      </button>
      {!mine.paused && (
        <span aria-hidden className="mx-1.5 flex h-3 items-end gap-0.5">
          {[0, 1, 2].map((bar) => (
            <span
              key={bar}
              className="w-0.5 animate-[speak-bar_900ms_ease-in-out_infinite] rounded-full bg-red-500"
              style={{ animationDelay: `${bar * 150}ms`, height: "100%" }}
            />
          ))}
        </span>
      )}
    </span>
  );
}
