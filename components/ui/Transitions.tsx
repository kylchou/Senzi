import { Suspense, ViewTransition } from "react";

/** Fades and lifts page content on navigation. Wrap each page's <main>. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}

/** Suspense whose skeleton fades out and whose content rises in when data arrives. */
export function StreamIn({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <ViewTransition exit="skeleton-exit" default="none">
          {fallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="content-enter" default="none">
        {children}
      </ViewTransition>
    </Suspense>
  );
}

/** Shared element that morphs between pages (for example a market title from card to detail). */
export function Morph({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
