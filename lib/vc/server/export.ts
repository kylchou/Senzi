import { NextResponse } from "next/server";
import { reportFilename, reportToCsv, reportToMarkdown } from "../reports";
import type { StudyReport } from "../types";

/** Serializes a report as a private, non-cacheable download. */
export function exportResponse(report: StudyReport, format: "json" | "markdown" | "csv") {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "json") return NextResponse.json({ data: report }, { headers });

  const [body, type, ext] =
    format === "csv"
      ? [reportToCsv(report), "text/csv; charset=utf-8", "csv"]
      : [reportToMarkdown(report), "text/markdown; charset=utf-8", "md"];
  headers["Content-Type"] = type;
  headers["Content-Disposition"] = `attachment; filename="${reportFilename(report, ext)}"`;
  return new NextResponse(body, { headers });
}
