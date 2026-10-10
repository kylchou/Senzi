"use client";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { ErrorState } from "@/components/ui/ErrorState";

export default function SearchError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="flex-1">
      <Container className="py-16">
        <ErrorState
          body="Search could not run. Try again shortly."
          action={
            <Button variant="outline" size="sm" onClick={reset}>
              Try again
            </Button>
          }
        />
      </Container>
    </main>
  );
}
