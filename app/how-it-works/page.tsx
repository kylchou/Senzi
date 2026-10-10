import type { Metadata } from "next";
import { TutorialExperience } from "@/components/tutorial/TutorialExperience";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "How it works",
  description: "A hands-on walkthrough of Senzi with a made-up startup and practice credits.",
};

export default function HowItWorksPage() {
  return (
    <main id="main" className="flex-1">
      <Container className="py-8 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-700">How it works</p>
          <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">Try a forecast, risk-free</h1>
          <p className="mt-3 text-ink-600">
            Everything here uses a made-up startup and practice credits. Your real balance, forecasts, and stats never change.
          </p>
        </div>
        <TutorialExperience />
      </Container>
    </main>
  );
}
