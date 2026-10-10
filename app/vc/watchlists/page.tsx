import { redirect } from "next/navigation";

/** The watchlist moved into Companies; old links (and ?startup=<id>) still land in the right place. */
export default async function WatchlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { startup } = await searchParams;
  redirect(typeof startup === "string" && startup ? `/vc/companies/${encodeURIComponent(startup)}` : "/vc/companies");
}
