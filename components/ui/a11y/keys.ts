/**
 * Accessibility preference shapes, defaults, and presets. Plain module (no
 * React, no browser APIs) so the pre-paint script and server code can use it.
 */

export const A11Y_STORAGE_KEY = "senzi-a11y";

export const TEXT_SIZES = ["sm", "md", "lg", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const CHART_MODES = ["default", "cvd", "contrast"] as const;
export type ChartMode = (typeof CHART_MODES)[number];

export interface A11yPrefs {
  dyslexia: boolean;
  textSize: TextSize;
  spacing: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  chart: ChartMode;
  focus: boolean;
  largeControls: boolean;
}

export type BooleanPref = { [K in keyof A11yPrefs]: A11yPrefs[K] extends boolean ? K : never }[keyof A11yPrefs];

export const DEFAULT_PREFS: A11yPrefs = {
  dyslexia: false,
  textSize: "md",
  spacing: false,
  highContrast: false,
  reduceMotion: false,
  chart: "default",
  focus: false,
  largeControls: false,
};

/** Attribute set on <html> while each on/off preference is enabled. Global CSS reacts to these. */
export const BOOLEAN_ATTRIBUTES: Record<BooleanPref, string> = {
  dyslexia: "data-dyslexia",
  spacing: "data-spacing",
  highContrast: "data-contrast",
  reduceMotion: "data-reduce-motion",
  focus: "data-focus",
  largeControls: "data-large-controls",
};

export const PRESETS = [
  { id: "standard", label: "Standard", prefs: DEFAULT_PREFS },
  {
    id: "reading",
    label: "Reading Friendly",
    prefs: { ...DEFAULT_PREFS, dyslexia: true, spacing: true, textSize: "lg" },
  },
  {
    id: "visibility",
    label: "High Visibility",
    prefs: { ...DEFAULT_PREFS, highContrast: true, textSize: "lg", chart: "contrast", largeControls: true },
  },
  {
    id: "motion",
    label: "Reduced Motion",
    prefs: { ...DEFAULT_PREFS, reduceMotion: true, focus: true },
  },
] as const satisfies readonly { id: string; label: string; prefs: A11yPrefs }[];

/** Fills gaps and drops invalid values from stored JSON. */
export function sanitizePrefs(value: unknown): A11yPrefs {
  const input = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof A11yPrefs, unknown>>;
  const prefs = { ...DEFAULT_PREFS };
  for (const key of Object.keys(BOOLEAN_ATTRIBUTES) as BooleanPref[]) {
    if (typeof input[key] === "boolean") prefs[key] = input[key];
  }
  if (TEXT_SIZES.includes(input.textSize as TextSize)) prefs.textSize = input.textSize as TextSize;
  if (CHART_MODES.includes(input.chart as ChartMode)) prefs.chart = input.chart as ChartMode;
  return prefs;
}

export function samePrefs(a: A11yPrefs, b: A11yPrefs): boolean {
  return (Object.keys(DEFAULT_PREFS) as (keyof A11yPrefs)[]).every((key) => a[key] === b[key]);
}

export const isDefaultPrefs = (prefs: A11yPrefs) => samePrefs(prefs, DEFAULT_PREFS);

/**
 * Pre-paint source that applies stored preferences to <html>, so text size,
 * contrast, and motion are right on the first frame. Mirrors applyPrefs().
 */
export const A11Y_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${A11Y_STORAGE_KEY}")||"{}"),r=document.documentElement,b=${JSON.stringify(
  BOOLEAN_ATTRIBUTES,
)};for(var k in b)if(p[k]===true)r.setAttribute(b[k],"");if(["sm","lg","xl"].indexOf(p.textSize)>-1)r.setAttribute("data-text-size",p.textSize);if(["cvd","contrast"].indexOf(p.chart)>-1)r.setAttribute("data-chart",p.chart)}catch(e){}`;
