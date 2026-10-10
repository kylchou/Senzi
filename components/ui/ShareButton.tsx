"use client";

import { Share2 } from "lucide-react";
import { Button } from "./Button";
import { toast } from "./Toaster";

/** Uses the native share sheet where available, otherwise copies the link. */
export function ShareButton({ title, path }: { title: string; path: string }) {
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Could not copy the link", "error");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={share}>
      <Share2 className="size-4" aria-hidden />
      Share
    </Button>
  );
}
