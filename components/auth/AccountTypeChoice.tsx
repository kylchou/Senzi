import { Briefcase, LineChart } from "lucide-react";
import type { AccountType } from "@/lib/types";

const OPTIONS: { type: AccountType; title: string; body: string; Icon: typeof LineChart }[] = [
  {
    type: "TRADER",
    title: "I want to forecast",
    body: "Trade on public startup questions with virtual credits and track your results.",
    Icon: LineChart,
  },
  {
    type: "VC",
    title: "I'm with a VC firm",
    body: "Open questions about startups and read your firm's private research. VC accounts can't trade.",
    Icon: Briefcase,
  },
];

/**
 * The two account types as big buttons. With `onPick` they're plain buttons;
 * without, they submit the surrounding form with name="accountType".
 */
export function AccountTypeChoice({ onPick }: { onPick?: (type: AccountType) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ type, title, body, Icon }) => (
          <button
            key={type}
            type={onPick ? "button" : "submit"}
            name={onPick ? undefined : "accountType"}
            value={type}
            onClick={onPick ? () => onPick(type) : undefined}
            className="surface-card flex flex-col items-start gap-3 p-5 text-left transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-red-500"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-night text-white">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="font-display text-lg font-semibold text-ink-900">{title}</span>
            <span className="text-sm text-ink-600">{body}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-ink-500">You choose once. After that, only a Senzi admin can change it.</p>
    </div>
  );
}
