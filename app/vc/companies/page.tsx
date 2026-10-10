import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageContext } from "@/lib/vc/server/page";
import { requireCompanyOrg } from "@/lib/vc/server/company-model";
export default async function CompaniesPage() {
  requireCompanyOrg(await requirePageContext("/vc/companies"));
  const companies = await db.startup.findMany({where:{isPublished:true},select:{id:true,name:true,slug:true},orderBy:{name:"asc"},take:200});
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">Companies</h1><p className="text-sm text-slate-500">Track public signals, enter private metrics, and read your firm?s questions.</p><div className="grid gap-3 sm:grid-cols-3">{companies.map(c=><Link className="rounded-lg border p-4 hover:underline" key={c.id} href={`/vc/companies/${c.slug}`}>{c.name}</Link>)}</div>{!companies.length && <p>No companies available yet.</p>}</div>;
}
