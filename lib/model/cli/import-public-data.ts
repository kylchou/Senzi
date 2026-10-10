// Idempotently imports collected public observations into the application DB.
// Run: npx tsx lib/model/cli/import-public-data.ts
import 'dotenv/config';
import { db } from '../../../lib/db';
import type { ModelSource } from '../../../generated/prisma/enums';
import { COMPANIES } from '../catalog';
import { FileModelStore } from '../store';

async function main() {
  const store = new FileModelStore();
  for (const company of COMPANIES) {
    // Require an explicit slug match; never guess identities from similar names.
    const startup = await db.startup.findUnique({ where: { slug: company.id } });
    if (!startup) { console.log(`Skipped ${company.id}: no matching startup slug`); continue; }
    let imported = 0;
    for (const p of store.readPoints(company.id)) {
      if (p.provenance !== 'scraped' || p.simulated || p.source === 'sponsor') continue;
      const where = { startupId: startup.id, metricId: p.metricId, source: p.source.toUpperCase() as ModelSource, periodStart: new Date(p.periodStart), periodEnd: new Date(p.periodEnd), organizationId: null };
      const data = { value: p.value, availableAt: new Date(p.availableAt), fetchedAt: new Date(p.fetchedAt), sourceUrl: p.sourceUrl, provenance: 'SCRAPED' as const, simulated: false, note: p.note };
      // Prisma cannot address nullable compound unique keys. The database's
      // NULLS NOT DISTINCT constraint protects the public key against races.
      await db.$transaction(async tx => {
        const existing = await tx.modelDataPoint.findFirst({ where });
        if (existing) await tx.modelDataPoint.update({ where: { id: existing.id }, data });
        else await tx.modelDataPoint.create({ data: { ...where, ...data } });
      });
      imported++;
    }
    console.log(`${company.id}: imported ${imported} public observations`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
