"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { ErrorState } from "@/components/ui/ErrorState";

/** Fallback for any page without its own error.tsx, so one failure doesn't blank the whole site. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="flex-1">
      <Container className="py-16">
        <ErrorState
          body={`This page could not load. Try again shortly.${error.digest ? ` (Ref ${error.digest})` : ""}`}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Try again
              </Button>
              <ButtonLink href="/markets" variant="ghost" size="sm">
                Go to markets
              </ButtonLink>
            </div>
          }
        />
      </Container>
    </main>
  );
}
