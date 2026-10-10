"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { getMe, type Me } from "./me-client";

function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Good morning, Sahil" with the virtual credit balance, for signed-in visitors only. */
export function HeroGreeting() {
  const { isLoaded, isSignedIn } = useAuth();
  const [me, setMe] = useState<{ user: Me; hour: number } | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let active = true;
    getMe().then((user) => active && user && setMe({ user, hour: new Date().getHours() }));
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn]);

  if (!isSignedIn || !me) return null;
  const firstName = me.user.displayName.split(/\s+/)[0];
  return (
    <p className="mb-5 inline-flex animate-[rise-in_360ms_var(--ease-out-soft)] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-mist-300">
      <span className="text-white">
        {greeting(me.hour)}, {firstName}
      </span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{new Intl.NumberFormat("en-US").format(me.user.creditBalance)} credits</span>
    </p>
  );
}
