"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "./cn";
import { setThemeMode } from "./theme";

/**
 * One-click light and dark switch. The icon is chosen by the `dark` class in
 * CSS, so it is correct on first paint with no hydration flash: a moon in light
 * mode, a sun in dark mode. The OS setting applies until the first click.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    setThemeMode(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className={cn(
        "grid size-9 place-items-center rounded-full text-ink-600 transition-[color,background-color,transform] duration-150 hover:bg-ink-100 hover:text-ink-900 active:scale-90",
        className,
      )}
    >
      <Moon className="size-[18px] dark:hidden" aria-hidden />
      <Sun className="hidden size-[18px] dark:block" aria-hidden />
    </button>
  );
}
