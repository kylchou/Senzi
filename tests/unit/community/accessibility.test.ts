import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, isDefaultPrefs, PRESETS, samePrefs, sanitizePrefs, A11Y_SCRIPT } from "@/components/ui/a11y/keys";
import { lineStyle, markerTimes, showsMarkers, type ChartSeries } from "@/components/ui/chart-style";
import { GLOSSARY } from "@/lib/glossary";

describe("accessibility preferences", () => {
  it("fills missing values and drops invalid ones", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ dyslexia: true, textSize: "huge", chart: "cvd", focus: "yes" })).toEqual({
      ...DEFAULT_PREFS,
      dyslexia: true,
      chart: "cvd",
    });
  });

  it("recognizes defaults and presets", () => {
    expect(isDefaultPrefs(DEFAULT_PREFS)).toBe(true);
    expect(isDefaultPrefs({ ...DEFAULT_PREFS, textSize: "lg" })).toBe(false);
    const reading = PRESETS.find((preset) => preset.id === "reading")!;
    expect(samePrefs(sanitizePrefs(JSON.parse(JSON.stringify(reading.prefs))), reading.prefs)).toBe(true);
  });

  it("every preset differs from the others", () => {
    for (const a of PRESETS) {
      for (const b of PRESETS) if (a !== b) expect(samePrefs(a.prefs, b.prefs)).toBe(false);
    }
  });

  it("pre-paint script applies stored settings to the root element", () => {
    const attributes: Record<string, string> = {};
    const root = { setAttribute: (name: string, value: string) => (attributes[name] = value) };
    const storage = { getItem: () => JSON.stringify({ dyslexia: true, textSize: "xl", chart: "contrast", focus: false }) };
    new Function("localStorage", "document", A11Y_SCRIPT)(storage, { documentElement: root });
    expect(attributes).toEqual({ "data-dyslexia": "", "data-text-size": "xl", "data-chart": "contrast" });
  });
});

describe("chart accessibility styles", () => {
  const replay: ChartSeries[] = ["model", "general", "verified"];
  const market: ChartSeries[] = ["allocation", "calibrated", "baseline"];

  it("gives each line its own pattern and marker outside the default mode", () => {
    for (const mode of ["cvd", "contrast"] as const) {
      for (const group of [replay, market]) {
        const styles = group.map((series) => lineStyle(series, mode));
        expect(new Set(styles.map((style) => style.dash ?? "solid")).size).toBe(3);
        expect(new Set(styles.map((style) => style.marker)).size).toBe(3);
      }
      expect(showsMarkers(mode)).toBe(true);
    }
    expect(showsMarkers("default")).toBe(false);
  });

  it("uses solid, dashed, and dotted for Model, General, and Verified", () => {
    expect(lineStyle("model", "cvd").dash).toBeUndefined();
    expect(lineStyle("general", "cvd").dash).toMatch(/^\d+ \d+$/);
    expect(lineStyle("verified", "cvd").cap).toBe("round");
  });

  it("high contrast lines are at least as heavy as color-blind ones", () => {
    for (const series of [...replay, ...market]) {
      expect(lineStyle(series, "contrast").width).toBeGreaterThanOrEqual(lineStyle(series, "cvd").width);
    }
  });

  it("spaces markers evenly inside the range", () => {
    expect(markerTimes(0, 70, 6)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(markerTimes(5, 5)).toEqual([]);
  });
});

describe("glossary", () => {
  it("explains every listed term in one or two short sentences", () => {
    for (const entry of Object.values(GLOSSARY)) {
      expect(entry.body.length).toBeLessThan(160);
      expect(entry.body).not.toContain(String.fromCharCode(0x2014));
    }
    expect(GLOSSARY.verified.body).toBe("People who have been verified as actual users of this startup's product.");
  });
});
