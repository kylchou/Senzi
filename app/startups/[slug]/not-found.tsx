import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";

export default function StartupNotFound() {
  return (
    <main id="main" className="flex-1">
      <Container className="py-16">
        <EmptyState
          title="Startup not found"
          action={
            <ButtonLink href="/startups" variant="outline" size="sm">
              Browse startups
            </ButtonLink>
          }
        />
      </Container>
    </main>
  );
}
