"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside a modal dialog while it is open. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      const container = ref.current;
      if (event.key !== "Tab" || !container) return;
      const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = container.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, active]);
}
