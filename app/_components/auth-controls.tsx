"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const buttonClass =
  "rounded-md px-3 py-1.5 text-sm font-medium border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

/** Sign in / sign up when signed out, the account menu when signed in. */
export function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton>
          <button className={buttonClass}>Sign in</button>
        </SignInButton>
        <SignUpButton>
          <button className={`${buttonClass} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900`}>
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
