import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";

export default function MarketNotFound() {
  return (
    <main id="main" className="flex-1">
      <Container className="py-16">
        <EmptyState
          illustration="markets"
          title="Market not found"
          body="It may have been removed or is not public."
          action={
            <ButtonLink href="/markets" variant="outline" size="sm">
              Browse markets
            </ButtonLink>
          }
        />
      </Container>
    </main>
  );
}
