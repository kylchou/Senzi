import { isPastDeadline } from "@/lib/market-view/format";
import type { PublicMarketStatus } from "@/lib/market-view/types";
import type { ResolutionOutcome } from "@/lib/types";
import { Badge } from "./Badge";

export function MarketStatusBadge({
  status,
  outcome,
  closesAt,
}: {
  status: PublicMarketStatus;
  outcome: ResolutionOutcome | null;
  closesAt: string;
}) {
  if (status === "RESOLVED") {
    return <Badge tone="dark">{outcome === "VOID" ? "Resolved: void" : `Resolved: ${outcome ?? "pending"}`}</Badge>;
  }
  if (status === "CANCELLED") return <Badge tone="outline">Cancelled</Badge>;
  if (status === "CLOSED" || isPastDeadline(closesAt)) return <Badge>Closed</Badge>;
  return (
    <Badge tone="live" dot>
      Open
    </Badge>
  );
}
