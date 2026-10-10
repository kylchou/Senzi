import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The model and company pages read scraped data from data/model at runtime; ship it with the server bundle.
  outputFileTracingIncludes: {
    "/**/*": ["./data/model/points/**/*", "./data/model/*.jsonl", "./data/model/*.json"],
  },
  experimental: {
    // Product-user screenshots are up to 3 MB (lib/product-verification.ts).
    serverActions: { bodySizeLimit: "4mb" },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
