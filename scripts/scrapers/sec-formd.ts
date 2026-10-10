// SEC EDGAR Form D filings (private offerings). EDGAR's fair-access policy
// requires a User-Agent naming the requester and a contact email, read from
// SEC_USER_AGENT; the collector refuses to run without it. At most 10 req/s.
//
// Only offering amounts and dates are kept. The filings also list executives'
// names and addresses; those are deliberately not stored.

import { metricIds } from '../../lib/model/catalog.js';
import { addDays } from '../../lib/model/dates.js';
import type { DataPoint } from '../../lib/model/types.js';
import { describeError, point, type Collector } from './common.js';
import { MissingEnvError } from './env.js';

interface Submissions {
  name: string;
  filings: { recent: { form: string[]; filingDate: string[]; accessionNumber: string[] } };
}

export const MAX_FORM_D_FILINGS = 8;

/** Reads a numeric XML tag. Returns null for missing or non-numeric values such as "Indefinite". */
export function xmlNumber(xml: string, tag: string): number | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`));
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) && m[1]!.trim() !== '' ? n : null;
}

export const collectFormD: Collector = async (company, ctx) => {
  const points: DataPoint[] = [];
  const missing: string[] = [];
  if (!company.secCik) {
    return { source: 'sec_edgar', companyId: company.id, points, missing: ['No Form D filer found on EDGAR for this company'] };
  }
  if (!ctx.env.secUserAgent) {
    throw new MissingEnvError('SEC_USER_AGENT', 'SEC EDGAR requires a User-Agent with a contact email.');
  }
  const headers = { 'User-Agent': ctx.env.secUserAgent };
  const cikNum = String(Number(company.secCik));
  const subsUrl = `https://data.sec.gov/submissions/CIK${company.secCik.padStart(10, '0')}.json`;

  let subs: Submissions;
  try {
    subs = await ctx.http.getJson<Submissions>(subsUrl, { headers });
  } catch (err) {
    return { source: 'sec_edgar', companyId: company.id, points, missing: [`EDGAR submissions: ${describeError(err)}`] };
  }

  const r = subs.filings.recent;
  const filings = r.form
    .map((form, i) => ({ form, date: r.filingDate[i]!, accession: r.accessionNumber[i]! }))
    .filter((f) => f.form === 'D' || f.form === 'D/A')
    .slice(0, MAX_FORM_D_FILINGS);
  if (!filings.length) missing.push('No Form D filings in EDGAR recent filings');

  for (const f of filings) {
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${f.accession.replace(/-/g, '')}/primary_doc.xml`;
    try {
      const xml = await ctx.http.getText(docUrl, { headers });
      const note = `${f.form === 'D/A' ? 'Form D/A (amendment)' : 'Form D'} ${f.accession}`;
      const availableAt = `${addDays(f.date, 1)}T00:00:00.000Z`;
      const base = { companyId: company.id, source: 'sec_edgar' as const, periodStart: f.date, periodEnd: f.date, availableAt, sourceUrl: docUrl, note };
      const sold = xmlNumber(xml, 'totalAmountSold');
      const offering = xmlNumber(xml, 'totalOfferingAmount');
      if (sold !== null) points.push(point({ ...base, metricId: metricIds.formDAmountSold, value: sold }, ctx.now));
      else missing.push(`${note}: amount sold not stated`);
      if (offering !== null) points.push(point({ ...base, metricId: metricIds.formDOffering, value: offering }, ctx.now));
      else missing.push(`${note}: total offering amount not numeric (e.g. "Indefinite")`);
    } catch (err) {
      missing.push(`Form D ${f.accession}: ${describeError(err)}`);
    }
  }
  return { source: 'sec_edgar', companyId: company.id, points, missing };
};
