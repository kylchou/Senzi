import { cn } from "./cn";

/**
 * Single-choice pill chips backed by radio inputs, so they work in a plain GET
 * form (FilterForm submits when one changes). The checked chip turns solid.
 */
export function ChipGroup({
  name,
  label,
  options,
  value,
  className,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">{label}</legend>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {options.map((option) => (
          <label
            key={option.value}
            className="relative inline-flex h-9 shrink-0 cursor-pointer select-none items-center rounded-full border border-ink-200 bg-surface px-4 text-sm font-medium text-ink-600 transition-[color,background-color,border-color,transform] duration-150 hover:border-ink-300 hover:text-ink-900 active:scale-95 has-[:checked]:border-ink-900 has-[:checked]:bg-ink-900 has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-red-500"
          >
            <input type="radio" name={name} value={option.value} defaultChecked={option.value === value} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
