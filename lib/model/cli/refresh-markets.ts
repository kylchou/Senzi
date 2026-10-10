// Pushes new model values to open markets after a scrape. Run after
// `npm run scrape`; the daily VC cron runs the same refresh.
//
//   npm run model:refresh-markets

import { db } from "@/lib/db";
import { refreshMarketModels } from "../market-refresh";

async function main() {
  const r = await refreshMarketModels();
  console.log(`Checked ${r.checked} open markets: ${r.published} published, ${r.unchanged} unchanged, ${r.skipped.length} skipped.`);
  for (const s of r.skipped) console.log(`  skip ${s.marketId}: ${s.reason}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
