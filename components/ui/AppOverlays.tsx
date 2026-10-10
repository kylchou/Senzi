import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { Toaster } from "./Toaster";

/** App-wide pieces rendered once in the root layout: mobile tab bar, search palette, and toasts. */
export function AppOverlays() {
  return (
    <>
      <BottomNav />
      <CommandPalette />
      <Toaster />
    </>
  );
}
