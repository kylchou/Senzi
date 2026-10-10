"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { QUICK_ACTIONS, type ChatTurn } from "@/lib/vc/assistant/prompt";
import { KIND_LABEL } from "@/lib/vc/assistant/render";
import type { CheckedCitation, CheckedSentence, ContextScope } from "@/lib/vc/assistant/types";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import type { AskResult } from "@/lib/vc/services/assistant";

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; result: AskResult }
  | { role: "error"; content: string };

/**
 * Below the md breakpoint the site shows a fixed bottom tab bar
 * (components/ui/BottomNav.tsx, about 3.5rem tall), so Tyche sits above it there.
 */
const CORNER = "right-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_4.25rem)] md:bottom-4";

const STUDY_PATH = /^\/vc\/studies\/([^/]+)(?:\/(?:report|edit))?\/?$/;

/** The study or comparison on screen, if any. Tyche answers about that subject only. */
function subjectFrom(pathname: string, ids: string | null): { key: string; scope: ContextScope } | null {
  const study = STUDY_PATH.exec(pathname);
  if (study && study[1] !== "new") return { key: `study:${study[1]}`, scope: { kind: "study", studyId: study[1] } };
  if (pathname === "/vc/compare") {
    const startupIds = [...new Set((ids ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 4);
    if (startupIds.length >= 2) return { key: `compare:${startupIds.join(",")}`, scope: { kind: "comparison", startupIds } };
  }
  return null;
}

function TycheIcon({ className = "" }: { className?: string }) {
  // A simple four-point spark: reads as "AI" without imitating any brand.
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 2.5c.4 3.9 1.7 6.5 3.4 8.1 1.6 1.5 4 2.4 6.1 2.4-2.1 0-4.5.9-6.1 2.4-1.7 1.6-3 4.2-3.4 8.1-.4-3.9-1.7-6.5-3.4-8.1-1.6-1.5-4-2.4-6.1-2.4 2.1 0 4.5-.9 6.1-2.4C10.3 9 11.6 6.4 12 2.5Z" />
    </svg>
  );
}

function SourceLink({ c, children }: { c: CheckedCitation; children: React.ReactNode }) {
  const cls = "underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600 dark:decoration-slate-600";
  return c.href.startsWith("/") ? (
    <Link href={c.href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={c.href} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
      {children}
    </a>
  );
}

/** Renders a checked answer: paragraphs and bullets, numbered citations, and a sources list. */
function Answer({ result }: { result: AskResult }) {
  const numbers = new Map<string, number>();
  const sources: CheckedCitation[] = [];
  for (const s of result.answer.sentences) {
    for (const c of s.citations) {
      if (!numbers.has(c.id)) {
        numbers.set(c.id, numbers.size + 1);
        sources.push(c);
      }
    }
  }

  // Group sentences into blocks: a new line starts a new paragraph or bullet.
  const blocks: { bullet: boolean; sentences: CheckedSentence[] }[] = [];
  for (const s of result.answer.sentences) {
    const bullet = /^[-•*]\s/.test(s.text);
    if (s.startsLine || blocks.length === 0) blocks.push({ bullet, sentences: [s] });
    else blocks[blocks.length - 1].sentences.push(s);
  }

  const sentence = (s: CheckedSentence, i: number) => {
    const text = s.text.replace(/^[-•*]\s/, "");
    const errors = s.issues.filter((x) => x.severity === "error");
    const title = errors.length ? errors.map((x) => x.message).join(" ") : s.unsupported ? "Not from your data" : undefined;
    return (
      <span key={i}>
        <span
          title={title}
          className={
            errors.length
              ? "underline decoration-amber-500 decoration-dotted underline-offset-2"
              : s.unsupported
                ? "text-slate-500 dark:text-slate-400"
                : undefined
          }
        >
          {text}
        </span>
        {s.citations.length > 0 && (
          <sup className="ml-0.5 text-[10px] font-semibold">
            {s.citations.map((c, j) => (
              <span key={c.id}>
                {j > 0 && ","}
                <SourceLink c={c}>{numbers.get(c.id)}</SourceLink>
              </span>
            ))}
          </sup>
        )}{" "}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.bullet ? (
          <ul key={i} className="list-disc pl-4">
            <li>{b.sentences.map(sentence)}</li>
          </ul>
        ) : (
          <p key={i}>{b.sentences.map(sentence)}</p>
        ),
      )}
      {sources.length > 0 && (
        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sources</p>
          <ol className="space-y-0.5 text-xs">
            {sources.map((c) => (
              <li key={c.id} className="flex gap-1.5">
                <span className="tabular-nums text-slate-500">{numbers.get(c.id)}.</span>
                <span>
                  <span className="text-slate-500">{KIND_LABEL[c.kind]} · </span>
                  <SourceLink c={c}>{c.label}</SourceLink>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {result.answer.sentences.some((s) => s.unsupported) && (
        <p className="text-[11px] text-slate-500">Grey text isn&apos;t backed by a cited source.</p>
      )}
    </div>
  );
}

/**
 * Tyche, the AI research assistant: a bubble fixed to the bottom-right corner
 * that opens a small chat box about the study or comparison on screen.
 */
export function Tyche({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const subject = subjectFrom(pathname, params.get("ids"));

  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);

  const messages = subject ? conversations[subject.key] ?? [] : [];
  const lastSubjectLabel = [...messages].reverse().find((m): m is Extract<Message, { role: "assistant" }> => m.role === "assistant")
    ?.result.subject;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, subject?.key]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        bubbleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    // While waiting, show the typing indicator; when an answer arrives, show where it starts.
    if (pending) endRef.current?.scrollIntoView({ block: "end" });
    else lastRef.current?.scrollIntoView({ block: "start" });
  }, [messages.length, pending]);

  function close() {
    setOpen(false);
    bubbleRef.current?.focus();
  }

  async function ask(question: string) {
    if (!subject || !question.trim() || pending) return;
    const key = subject.key;
    const history: ChatTurn[] = messages.flatMap((m): ChatTurn[] =>
      m.role === "user" ? [{ role: "user", content: m.content }] : m.role === "assistant" ? [{ role: "assistant", content: m.result.raw }] : [],
    );
    setConversations((all) => ({ ...all, [key]: [...(all[key] ?? []), { role: "user", content: question.trim() }] }));
    setInput("");
    setPending(true);
    try {
      const result = await vcFetch<AskResult>("/api/vc/assistant", {
        method: "POST",
        json: { scope: subject.scope, question: question.trim(), history },
      });
      setConversations((all) => ({ ...all, [key]: [...(all[key] ?? []), { role: "assistant", result }] }));
    } catch (err) {
      const content = err instanceof VcApiError ? err.message : "Tyche couldn't answer right now. Try again in a moment.";
      setConversations((all) => ({ ...all, [key]: [...(all[key] ?? []), { role: "error", content }] }));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  }

  if (!open) {
    return (
      <button
        ref={bubbleRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Tyche, the AI research assistant"
        className={`fixed ${CORNER} z-50 flex items-center gap-2 rounded-full bg-red-600 py-2.5 pl-3 pr-4 text-white shadow-lg ring-1 ring-red-700/50 transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 print:hidden`}
      >
        <TycheIcon className="h-5 w-5" />
        <span className="text-left leading-tight">
          <span className="block text-sm font-semibold">Ask Tyche</span>
          <span className="block text-[10px] font-medium uppercase tracking-wider text-red-100">AI assistant</span>
        </span>
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className={`fixed ${CORNER} z-50 flex h-[min(560px,calc(100dvh_-_7rem))] md:h-[min(560px,calc(100dvh_-_2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 print:hidden`}
    >
      <header className="flex items-start gap-2 border-b border-slate-200 bg-red-600 px-3 py-2.5 text-white dark:border-slate-700">
        <TycheIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="flex items-center gap-1.5 text-sm font-semibold">
            Tyche
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">AI assistant</span>
          </h2>
          <p className="truncate text-xs text-red-100" title={lastSubjectLabel ?? undefined}>
            {subject ? lastSubjectLabel ?? (subject.scope.kind === "study" ? "About this study" : "About this comparison") : "No study open"}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close Tyche"
          className="rounded p-1 text-red-100 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4" fill="currentColor">
            <path d="M5.3 4.2a.75.75 0 0 0-1.1 1.1L8.94 10l-4.7 4.7a.75.75 0 1 0 1.06 1.06L10 11.06l4.7 4.7a.75.75 0 1 0 1.06-1.06L11.06 10l4.7-4.7a.75.75 0 0 0-1.06-1.06L10 8.94 5.3 4.2Z" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm" aria-live="polite">
        {!enabled ? (
          <p className="text-slate-600 dark:text-slate-300">
            Tyche isn&apos;t set up yet. An admin needs to add the AI provider key before it can answer.
          </p>
        ) : !subject ? (
          <p className="text-slate-600 dark:text-slate-300">
            Hi, I&apos;m Tyche. Open a study, or compare startups, and I&apos;ll answer questions about it using only the data
            Senzi has on it, with every source cited.
          </p>
        ) : messages.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-300">
            Hi, I&apos;m Tyche. I answer using only the data Senzi has on this{" "}
            {subject.scope.kind === "study" ? "study" : "comparison"}: its estimates, history, sources, facts and news. Every
            claim links to its source. Try a quick action below or ask your own question.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} ref={i === messages.length - 1 ? lastRef : undefined}>
              {m.role === "user" ? (
              <div className="ml-8 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">{m.content}</div>
            ) : m.role === "assistant" ? (
              <div className="mr-2">
                <Answer result={m.result} />
              </div>
            ) : (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                {m.content}
              </p>
              )}
            </div>
          ))
        )}
        {pending && (
          <p className="flex items-center gap-2 text-slate-500">
            <span className="inline-flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500" />
            </span>
            Tyche is reading the evidence…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 px-3 pb-2 pt-2 dark:border-slate-700">
        {enabled && subject && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={pending}
                onClick={() => void ask(a.prompt)}
                className="rounded-full border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <label htmlFor={`${titleId}-input`} className="sr-only">
            Ask Tyche
          </label>
          <textarea
            id={`${titleId}-input`}
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!enabled || !subject || pending}
            placeholder={subject ? "Ask about this data…" : "Open a study to ask Tyche"}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={!enabled || !subject || pending || !input.trim()}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Tyche is an AI. It uses only Senzi data you can already see and can still make mistakes. Not investment advice.
        </p>
      </div>
    </section>
  );
}
