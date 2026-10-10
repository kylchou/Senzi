import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, moveWidget, parseLayout, toggleWidget } from "@/lib/profile/layout";

describe("profile layout", () => {
  it("falls back to the default for missing or broken data", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("{nope")).toEqual(DEFAULT_LAYOUT);
  });

  it("drops unknown sections and appends new ones", () => {
    const layout = parseLayout(JSON.stringify({ order: ["activity", "gone", "activity", "summary"], hidden: ["balance", "gone"] }));
    expect(layout.order.slice(0, 2)).toEqual(["activity", "summary"]);
    expect([...layout.order].sort()).toEqual([...DEFAULT_LAYOUT.order].sort());
    expect(layout.hidden).toEqual(["balance"]);
  });

  it("moves within bounds and toggles visibility", () => {
    const down = moveWidget(DEFAULT_LAYOUT, "summary", 1);
    expect(down.order.slice(0, 2)).toEqual(["balance", "summary"]);
    expect(moveWidget(DEFAULT_LAYOUT, "summary", -1)).toBe(DEFAULT_LAYOUT);
    const hidden = toggleWidget(DEFAULT_LAYOUT, "activity");
    expect(hidden.hidden).toEqual(["activity"]);
    expect(toggleWidget(hidden, "activity").hidden).toEqual([]);
  });
});
