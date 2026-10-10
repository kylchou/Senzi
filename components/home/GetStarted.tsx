"use client";

import { SignUpButton, useAuth } from "@clerk/nextjs";
import { Button, ButtonLink } from "@/components/ui/Button";

/** "Get started" signs visitors up; signed-in users go to their profile. */
export function GetStarted({ variant = "outline" }: { variant?: "outline" | "accent" }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) {
    return (
      <ButtonLink href="/profile" variant={variant} size="lg">
        Your profile
      </ButtonLink>
    );
  }
  return (
    <SignUpButton mode="modal">
      <Button variant={variant} size="lg">
        Get started
      </Button>
    </SignUpButton>
  );
}
