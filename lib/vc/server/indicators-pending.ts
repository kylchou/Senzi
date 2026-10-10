import type { IndicatorGateway } from "../ports";

/**
 * Used until lib/model can be bundled by Next.js: its relative imports end in
 * ".js" (for example './store.js'), which Turbopack can't resolve to the .ts
 * files, so importing it fails `next build`. Once those suffixes are dropped,
 * switch container.ts to createIndicatorGateway() from ./indicators-adapter.
 */
export function createPendingIndicatorGateway(): IndicatorGateway {
  return {
    async getIndicators() {
      return { status: "unavailable", rows: [] };
    },
  };
}
