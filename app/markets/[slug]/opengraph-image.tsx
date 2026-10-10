import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { formatDate, formatShare } from "@/lib/market-view/format";
import { getMarket } from "@/lib/market-view/queries";

export const alt = "Senzi market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NIGHT = "#25282b";
const RED = "#ff2c2c";
const MIST = "#a3a8ad";

/** Link preview for a public market: question, allocation bar, baseline, and deadline. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const [market, logo] = await Promise.all([
    getMarket((await params).slug),
    readFile(path.join(process.cwd(), "public/senzi-logo.png")).then((file) => `data:image/png;base64,${file.toString("base64")}`),
  ]);

  const share = market?.allocation.share ?? null;
  const question = market?.question ?? "Forecast what startups do next.";
  const status = !market
    ? null
    : market.resolution
      ? market.resolution.outcome === "VOID"
        ? "Resolved: void"
        : `Resolved: ${market.resolution.outcome}`
      : market.status === "OPEN"
        ? `Closes ${formatDate(market.closesAt)}`
        : "Closed";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: NIGHT, padding: 72, color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={154} height={44} alt="" />
          {status && (
            <div style={{ display: "flex", fontSize: 26, color: MIST, border: `2px solid rgba(255,255,255,0.15)`, borderRadius: 999, padding: "8px 22px" }}>
              {status}
            </div>
          )}
        </div>

        {market && <div style={{ display: "flex", marginTop: 56, fontSize: 30, color: MIST }}>{market.startup.name}</div>}
        <div
          style={{
            display: "flex",
            marginTop: 14,
            fontSize: question.length > 80 ? 52 : 60,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: -1,
            maxWidth: 1000,
          }}
        >
          {question}
        </div>

        {market && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
                <span style={{ fontSize: 84, fontWeight: 800 }}>{formatShare(share)}</span>
                <span style={{ fontSize: 30, color: MIST }}>YES allocation</span>
              </div>
              {market.openingBaseline !== null && (
                <span style={{ fontSize: 30, color: MIST }}>Baseline {formatShare(market.openingBaseline)}</span>
              )}
            </div>
            <div style={{ display: "flex", marginTop: 20, height: 16, borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{ display: "flex", width: `${(share ?? 0) * 100}%`, background: RED, borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 22, color: MIST }}>
              Virtual credits only. Forecasts are research signals, not investment advice.
            </div>
          </div>
        )}
      </div>
    ),
    size,
  );
}
