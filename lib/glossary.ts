/** Plain-language explanations for terms new forecasters may not know. */
export const GLOSSARY = {
  model: {
    term: "Senzi Model",
    body: "Senzi's own estimate, computed from public data and how similar questions turned out.",
  },
  general: {
    term: "General Users",
    body: "Everyone forecasting on Senzi. This is the community's estimate.",
  },
  verified: {
    term: "Verified Users",
    body: "People who have been verified as actual users of this startup's product.",
  },
  probability: {
    term: "Probability",
    body: "How likely something is, from 0% (will not happen) to 100% (certain).",
  },
  resolution: {
    term: "Market resolution",
    body: "After the deadline, Senzi checks the evidence and records the answer as YES or NO. Forecasts are scored then.",
  },
  credits: {
    term: "Virtual credits",
    body: "Points you place on forecasts. They have no cash value and cannot be bought or withdrawn.",
  },
  forecast: {
    term: "Forecast",
    body: "Your answer to a market: YES or NO, backed by the credits you choose to place.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
