import Link from "next/link";
import { ChevronRight, ChevronsLeft } from "lucide-react";
import { toQueryString } from "@/lib/discovery/params";

/** Cursor pagination: a link back to the first page and a link to the next one. */
export function Pagination({
  basePath,
  params,
  isFirstPage,
  nextCursor,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  isFirstPage: boolean;
  nextCursor: string | null;
}) {
  if (isFirstPage && !nextCursor) return null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-full border border-ink-200 px-3.5 text-sm font-medium text-ink-800 hover:bg-ink-50";

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-between gap-4">
      {isFirstPage ? (
        <span />
      ) : (
        <Link href={`${basePath}${toQueryString(params)}`} className={linkClass}>
          <ChevronsLeft className="size-4" aria-hidden /> First page
        </Link>
      )}
      {nextCursor && (
        <Link href={`${basePath}${toQueryString({ ...params, cursor: nextCursor })}`} className={linkClass}>
          Next page <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
