"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { AlertCircle, Check, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { toast } from "@/components/ui/Toaster";
import { refreshMe } from "@/components/ui/me-client";
import { formatCredits, formatDateTime, formatShare } from "@/lib/market-view/format";
import {
  errorMessage,
  fetchBalance,
  ForecastError,
  submitForecast,
  validateCredits,
  type ForecastReceiptData,
  type ForecastSide,
} from "@/lib/market-view/forecast-client";

const PRESETS = [10, 25, 50, 100];
const LAST_AMOUNT_KEY = "senzi-last-credits";

/** Last allocation the user submitted, so the panel opens with it. */
function lastAmount(): string {
  if (typeof window === "undefined") return "25";
  try {
    const stored = localStorage.getItem(LAST_AMOUNT_KEY);
    return stored && /^d+$/.test(stored) ? stored : "25";
  } catch {
    return "25";
  }
}

type Session = { state: "loading" } | { state: "signed-out" } | { state: "ready"; balance: number | null };

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ForecastPanel({
  marketId,
  isOpen,
}: {
  marketId: string;
  /** Server-derived: status is OPEN and the deadline has not passed. */
  isOpen: boolean;
}) {
  const router = useRouter();
  const amountId = useId();
  const errorId = useId();
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [side, setSide] = useState<ForecastSide>("YES");
  const [amount, setAmount] = useState(lastAmount);
  const [pulse, setPulse] = useState(0);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ForecastError | null>(null);
  const [closed, setClosed] = useState(!isOpen);
  const [receipt, setReceipt] = useState<ForecastReceiptData | null>(null);
  // One key per intended forecast, created on first submit and reused on retry
  // so the server can drop duplicates. Cleared whenever the forecast changes.
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetchBalance(controller.signal)
      .then((balance) => setSession({ state: "ready", balance }))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setSession(
          err instanceof ForecastError && err.code === "UNAUTHENTICATED"
            ? { state: "signed-out" }
            : { state: "ready", balance: null },
        );
      });
    return () => controller.abort();
  }, [isOpen]);

  const balance = session.state === "ready" ? session.balance : null;
  const validation = validateCredits(amount, balance);

  function changeIntent(update: () => void) {
    update();
    setError(null);
    idempotencyKey.current = null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (validation || submitting) return;
    setSubmitting(true);
    setError(null);
    idempotencyKey.current ??= newKey();
    try {
      const result = await submitForecast({ marketId, side, credits: Number(amount), idempotencyKey: idempotencyKey.current });
      setReceipt(result);
      if (typeof result.balanceAfter === "number") setSession({ state: "ready", balance: result.balanceAfter });
      refreshMe();
      toast(`Forecast recorded: ${formatCredits(result.credits)} credits on ${result.side}`);
      try {
        localStorage.setItem(LAST_AMOUNT_KEY, String(result.credits));
      } catch {
        // Remembering the amount is optional.
      }
      router.refresh();
    } catch (err) {
      const failure = err instanceof ForecastError ? err : new ForecastError("UNKNOWN", "");
      setError(failure);
      if (failure.code === "UNAUTHENTICATED") setSession({ state: "signed-out" });
      if (failure.code === "INVALID_STATE" || failure.code === "NOT_FOUND") setClosed(true);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setReceipt(null);
    setTouched(false);
    idempotencyKey.current = null;
    if (session.state === "ready" && receipt?.balanceAfter === undefined) {
      fetchBalance()
        .then((value) => setSession({ state: "ready", balance: value }))
        .catch(() => undefined);
    }
  }

  return (
    <section
      aria-labelledby="forecast-heading"
      className="surface-card p-5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="forecast-heading" className="font-display text-lg font-bold text-ink-900">
          Forecast
        </h2>
        <span className="text-xs text-ink-500">Virtual credits</span>
      </div>

      {closed ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
          <p>{error?.code === "NOT_FOUND" ? errorMessage(error) : "This market is closed to new forecasts."}</p>
        </div>
      ) : receipt ? (
        <Receipt receipt={receipt} onReset={reset} />
      ) : session.state === "loading" ? (
        <div className="mt-4 flex min-h-32 items-center justify-center text-ink-500" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <span className="sr-only">Loading</span>
        </div>
      ) : session.state === "signed-out" ? (
        <div className="mt-4 space-y-3">
          {error?.code === "UNAUTHENTICATED" && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {errorMessage(error)}
            </p>
          )}
          <p className="text-sm text-ink-600">Sign in to place a forecast with your virtual credits.</p>
          <SignInButton mode="modal">
            <Button variant="accent" className="w-full">
              Sign in
            </Button>
          </SignInButton>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-600">Your forecast</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["YES", "NO"] as const).map((option) => {
                const selected = side === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "relative flex h-14 cursor-pointer select-none items-center justify-center rounded-xl border-2 font-display text-lg font-bold transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-red-500",
                      selected && option === "YES" && "border-red-500 bg-red-50 text-ink-900",
                      selected && option === "NO" && "border-ink-900 bg-ink-50 text-ink-900",
                      !selected && "border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-900",
                    )}
                  >
                    <input
                      type="radio"
                      name="side"
                      value={option}
                      checked={selected}
                      onChange={() => changeIntent(() => setSide(option))}
                      className="sr-only"
                    />
                    {option}
                    {selected && <Check className="absolute right-3 top-3 size-4 animate-[pop-in_180ms_var(--ease-out-soft)]" aria-hidden />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label htmlFor={amountId} className="text-xs font-medium text-ink-600">
                Allocation
              </label>
              <span className="text-xs tabular-nums text-ink-500">
                {balance === null ? "Balance unavailable" : `${formatCredits(balance)} available`}
              </span>
            </div>
            <div className="relative">
              <input
                id={amountId}
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                onChange={(event) => changeIntent(() => setAmount(event.target.value.replace(/[^\d]/g, "")))}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && validation ? true : undefined}
                aria-describedby={touched && validation ? errorId : undefined}
                className={cn(
                  "h-12 w-full rounded-xl border border-ink-200 bg-surface pl-4 pr-20 font-display text-xl font-bold tabular-nums text-ink-900 transition-colors hover:border-ink-300 focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30",
                  touched && validation && "border-red-600",
                )}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-500">credits</span>
              {pulse > 0 && (
                <span
                  key={pulse}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 animate-[ring-pulse_500ms_ease-out] rounded-xl"
                />
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    changeIntent(() => {
                      setAmount(String(preset));
                      setPulse((count) => count + 1);
                    })
                  }
                  disabled={balance !== null && preset > balance}
                  className={cn(
                    "h-10 flex-1 rounded-lg border text-xs font-semibold tabular-nums transition-[color,background-color,border-color,transform] duration-150 active:scale-95 disabled:opacity-40 sm:h-8",
                    amount === String(preset)
                      ? "border-ink-900 bg-ink-900 text-surface"
                      : "border-ink-200 text-ink-700 hover:border-ink-300 hover:bg-ink-50",
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            {touched && validation && (
              <p id={errorId} className="mt-2 text-xs text-red-700">
                {validation}
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{errorMessage(error)}</span>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Submitting
              </>
            ) : (
              `Forecast ${side}`
            )}
          </Button>
          <p className="text-center text-xs text-ink-500">Virtual credits only. No cash value.</p>
        </form>
      )}
    </section>
  );
}

function Receipt({ receipt, onReset }: { receipt: ForecastReceiptData; onReset: () => void }) {
  const rows: [string, string][] = [
    ["Forecast", receipt.side],
    ["Allocation", `${formatCredits(receipt.credits)} credits`],
  ];
  if (receipt.entryAllocationShare != null) rows.push(["YES allocation at entry", formatShare(receipt.entryAllocationShare)]);
  if (receipt.balanceAfter !== undefined) rows.push(["Balance after", `${formatCredits(receipt.balanceAfter)} credits`]);
  rows.push(["Recorded", formatDateTime(receipt.createdAt)]);

  return (
    <div className="mt-4 animate-[rise-in_320ms_var(--ease-out-soft)]" role="status">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <span className="inline-flex size-6 animate-[pop-in_220ms_var(--ease-out-soft)] items-center justify-center rounded-full bg-red-500 text-white">
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="16"
              strokeDashoffset="16"
              className="animate-[draw_360ms_ease-out_180ms_forwards]"
            />
          </svg>
        </span>
        Forecast recorded
      </div>
      <dl className="mt-4 divide-y divide-ink-100 rounded-xl border border-ink-200 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-ink-600">{label}</dt>
            <dd className="text-right font-semibold tabular-nums text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 break-all text-[11px] text-ink-500">Receipt {receipt.id}</p>
      <Button variant="outline" className="mt-4 w-full" onClick={onReset}>
        New forecast
      </Button>
    </div>
  );
}
