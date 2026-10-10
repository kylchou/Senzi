"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "../Button";

// Loaded on demand so the market page stays light until someone opens a replay.
const MarketReplay = dynamic(() => import("./MarketReplay").then((module) => module.MarketReplay), { ssr: false });

/** "Replay" button next to the market chart. */
export function ReplayLauncher({ slug, startupName, question }: { slug: string; startupName: string; question: string }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={opener}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Watch how the Model, General Users, and Verified Users evolved"
      >
        <Play className="size-3.5" aria-hidden />
        Replay
      </Button>
      {open && (
        <MarketReplay
          slug={slug}
          startupName={startupName}
          question={question}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      )}
    </>
  );
}
