"use client";

import { MESSAGES, PATTERNS } from "@/lib/i18n/messages";
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_STORAGE_KEY, languageTag, type LanguageCode, type TargetLanguage } from "@/lib/i18n/languages";

/**
 * Page translation. English is the source. Interface text comes from the
 * built-in dictionary (lib/i18n/messages.ts), so it works in every browser.
 * Everything else (market questions, news, startup details) uses the browser's
 * on-device Translator API when it exists; nothing is sent to a server.
 *
 * Text nodes are translated in place (nodeValue only, never replaced), so
 * React keeps working: when React writes new English text, the observer sees
 * it and translates again. Nodes React has not hydrated yet are skipped and
 * retried, so hydration never sees translated text.
 */

export type MachineState = "idle" | "unsupported" | "downloading" | "ready";

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}
interface TranslatorFactory {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

const ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "KBD", "PRE", "TITLE"]);
const SKIP_SELECTOR = 'svg, [translate="no"], [data-no-translate], .cl-rootBox, .cl-modalBackdrop, .cl-userButtonPopoverCard';
const HAS_LETTER = /\p{L}/u;
const MAX_MACHINE_LENGTH = 1200;

type Entry = { source: string; shown: string };

const listeners = new Set<() => void>();
let state: { lang: LanguageCode; machine: MachineState } = { lang: DEFAULT_LANGUAGE, machine: "idle" };

function setState(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeTranslation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const translationState = () => state;

const texts = new Map<Text, Entry>();
const attributes = new Map<Element, Map<string, Entry>>();
const machineCache = new Map<string, Map<string, string>>();
let machine: { lang: TargetLanguage; instance: TranslatorInstance } | null = null;
let queue = new Set<string>();
let observer: MutationObserver | null = null;
let scheduled = false;
let retryTimer: number | null = null;

/** React marks elements it owns once hydrated; untouched server HTML has no marker yet. */
function isHydrated(element: Element): boolean {
  return Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
}

function skipped(element: Element | null): boolean {
  if (!element) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;
  return element.closest(SKIP_SELECTOR) !== null;
}

function lookup(source: string): string | null {
  const lang = state.lang;
  if (lang === "en") return null;
  const core = source.trim();
  if (!core || !HAS_LETTER.test(core)) return null;
  const dictionary = MESSAGES[lang];
  const known = dictionary[core] ?? dictionary[core.replace(/\s+/g, " ")];
  if (known !== undefined) return known;
  for (const [pattern, replacement] of PATTERNS[lang]) if (pattern.test(core)) return core.replace(pattern, replacement);
  const cached = machineCache.get(lang)?.get(core);
  if (cached !== undefined) return cached;
  if (machine?.lang === lang && core.length <= MAX_MACHINE_LENGTH) queue.add(core);
  return null;
}

/** Keeps the original leading and trailing spaces around a translation. */
function withSpacing(source: string, translated: string) {
  const lead = source.match(/^\s*/)?.[0] ?? "";
  const trail = source.match(/\s*$/)?.[0] ?? "";
  return lead + translated + trail;
}

let hydrationPending = false;

function processText(node: Text) {
  const parent = node.parentElement;
  if (skipped(parent)) return;
  if (!isHydrated(parent!)) {
    hydrationPending = true;
    return;
  }
  const current = node.nodeValue ?? "";
  const record = texts.get(node);
  const source = record && current === record.shown ? record.source : current;
  const translated = lookup(source);
  const shown = translated === null ? source : withSpacing(source, translated);
  if (current !== shown) node.nodeValue = shown;
  if (shown !== source || record) texts.set(node, { source, shown });
}

function processAttributes(element: Element) {
  if (skipped(element)) return;
  if (!isHydrated(element)) {
    hydrationPending = true;
    return;
  }
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    let records = attributes.get(element);
    const record = records?.get(name);
    const source = record && current === record.shown ? record.source : current;
    const translated = lookup(source);
    const shown = translated === null ? source : withSpacing(source, translated);
    if (current !== shown) element.setAttribute(name, shown);
    if (shown !== source || record) {
      if (!records) attributes.set(element, (records = new Map()));
      records.set(name, { source, shown });
    }
  }
}

function processTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    processText(root as Text);
    return;
  }
  if (!(root instanceof Element)) return;
  if (root.parentElement?.closest(SKIP_SELECTOR) || root.matches(SKIP_SELECTOR)) return;
  processAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (SKIP_TAGS.has(element.tagName) || element.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) processText(node as Text);
    else processAttributes(node as Element);
  }
}

function fullPass() {
  hydrationPending = false;
  processTree(document.body);
  // Forget nodes that left the page.
  for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
  for (const element of attributes.keys()) if (!element.isConnected) attributes.delete(element);
  if (hydrationPending) scheduleRetry();
  void drainQueue();
}

function scheduleRetry() {
  if (retryTimer !== null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (state.lang !== "en") fullPass();
  }, 400);
}

let pendingRoots = new Set<Node>();

function schedule(root: Node) {
  pendingRoots.add(root);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const roots = pendingRoots;
    pendingRoots = new Set();
    hydrationPending = false;
    for (const node of roots) if (node.isConnected) processTree(node);
    if (hydrationPending) scheduleRetry();
    void drainQueue();
  });
}

let draining = false;

/** Machine-translates queued strings, then repaints the page with the results. */
async function drainQueue() {
  if (draining || !machine || queue.size === 0) return;
  draining = true;
  const { lang, instance } = machine;
  let cache = machineCache.get(lang);
  if (!cache) machineCache.set(lang, (cache = new Map()));
  try {
    while (queue.size > 0 && machine?.lang === lang && state.lang === lang) {
      const batch = [...queue].slice(0, 12);
      batch.forEach((text) => queue.delete(text));
      const results = await Promise.all(batch.map((text) => instance.translate(text).catch(() => text)));
      batch.forEach((text, index) => cache!.set(text, results[index]));
      if (state.lang === lang) processTree(document.body);
    }
  } finally {
    draining = false;
  }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    if (state.lang === "en") return;
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach((node) => schedule(node));
      else schedule(record.target);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
}

function restoreEnglish() {
  for (const [node, record] of texts) if (node.isConnected && node.nodeValue === record.shown) node.nodeValue = record.source;
  for (const [element, records] of attributes) {
    for (const [name, record] of records) if (element.getAttribute(name) === record.shown) element.setAttribute(name, record.source);
  }
  texts.clear();
  attributes.clear();
}

async function prepareMachine(lang: TargetLanguage) {
  if (machine?.lang === lang) return;
  machine?.instance.destroy?.();
  machine = null;
  queue = new Set();
  const factory = (globalThis as unknown as { Translator?: TranslatorFactory }).Translator;
  if (!factory) {
    setState({ machine: "unsupported" });
    return;
  }
  try {
    const availability = await factory.availability({ sourceLanguage: "en", targetLanguage: lang });
    if (availability === "unavailable") {
      setState({ machine: "unsupported" });
      return;
    }
    if (availability !== "available") setState({ machine: "downloading" });
    const instance = await factory.create({ sourceLanguage: "en", targetLanguage: lang });
    if (state.lang !== lang) return instance.destroy?.();
    machine = { lang, instance };
    setState({ machine: "ready" });
    fullPass();
  } catch {
    // Creating a translator can need a click when its model is not downloaded yet.
    setState({ machine: "unsupported" });
  }
}

/** Switches the page language. Call from a click so the browser may download a model. */
export function setLanguage(lang: LanguageCode) {
  try {
    if (lang === DEFAULT_LANGUAGE) localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Storage unavailable: the language still applies to this page.
  }
  applyLanguage(lang);
}

function applyLanguage(lang: LanguageCode) {
  document.documentElement.lang = languageTag(lang);
  restoreEnglish();
  setState({ lang, machine: lang === "en" ? "idle" : state.machine === "unsupported" ? "unsupported" : "idle" });
  if (lang === "en") {
    machine?.instance.destroy?.();
    machine = null;
    queue = new Set();
    return;
  }
  startObserver();
  fullPass();
  void prepareMachine(lang);
}

let started = false;

/** Applies the saved language once per page load. */
export function startTranslation() {
  if (started) return;
  started = true;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    saved = null;
  }
  if (isLanguage(saved) && saved !== DEFAULT_LANGUAGE) applyLanguage(saved);
}

/** Translates one interface string outside the DOM (for example a toast). */
export function translateText(text: string): string {
  return lookup(text) ?? text;
}
