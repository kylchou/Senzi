"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Button } from "./Button";
import { cn } from "./cn";

/** Sign-in button when signed out, account menu when signed in. Clerk handles the flow. */
export function AuthControls({ variant = "primary", className }: { variant?: "primary" | "accent"; className?: string }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <span aria-hidden className={cn("inline-block h-8 w-20", className)} />;
  if (isSignedIn) return <UserButton />;
  return (
    <SignInButton mode="modal">
      <Button variant={variant} size={variant === "accent" ? "md" : "sm"} className={className}>
        Sign in
      </Button>
    </SignInButton>
  );
}

/** Sign-in call to action for signed-out visitors; renders `signedIn` (or nothing) otherwise. */
export function SignInCta({
  children,
  signedIn = null,
  variant = "accent",
  className,
}: {
  children: React.ReactNode;
  signedIn?: React.ReactNode;
  variant?: "accent" | "primary";
  className?: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return signedIn;
  return (
    <SignInButton mode="modal">
      <Button variant={variant} size="lg" className={className}>
        {children}
      </Button>
    </SignInButton>
  );
}
