/** Tunable thresholds and fixed copy for VC Intelligence. */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Minimum lead time between submission/opening and the forecast deadline. */
export const MIN_DEADLINE_LEAD_MS = DAY;
/** Deadlines further out than this are rejected as unmeasurable. */
export const MAX_DEADLINE_LEAD_MS = 3 * 365 * DAY;

/** A change in General LMSR price of at least this much (0..1) triggers an alert. */
export const MOVEMENT_ALERT_THRESHOLD = 0.1;
/** Smaller change still worth surfacing on the dashboard. */
export const MOVEMENT_DASHBOARD_THRESHOLD = 0.05;
export const MOVEMENT_WINDOW_MS = DAY;
export const DASHBOARD_MOVEMENT_WINDOW_MS = 7 * DAY;

/** Fewer participants than this means estimates are flagged as thin. */
export const LOW_PARTICIPATION_THRESHOLD = 10;
/** Movements are ignored when participation is below this. */
export const MIN_PARTICIPANTS_FOR_MOVEMENT = 3;

export const DEADLINE_ALERT_WINDOW_MS = 3 * DAY;
export const DASHBOARD_DEADLINE_WINDOW_MS = 14 * DAY;
/** Estimates older than this on an open study are shown as stale. */
export const STALE_ESTIMATE_MS = DAY;

export const MAX_TREND_POINTS = 200;
export const MAX_PARTICIPANTS = 500;
export const MAX_SOURCES = 20;

export const ALLOCATION_SHARE_LABEL = "General LMSR price";
export const ALLOCATION_SHARE_EXPLAINER =
  "The LMSR market-maker YES price from all trades. It is not a calibrated probability.";
export const BASELINE_EXPLAINER =
  "The opening baseline was set before community forecasting began, using the methodology shown. It is a starting reference, not a forecast.";
export const CALIBRATION_EXPLAINER =
  "A calibrated probability is shown only when enough resolved forecasts exist to evaluate calibration.";

export const VC_DISCLAIMER =
  "Senzi estimates are research signals generated from virtual-credit forecasts. They are not guaranteed predictions, investment advice, or recommendations. No real money is wagered. Do not share or act on material nonpublic information.";

export const STANDARD_LIMITATIONS = [
  "Forecasts use virtual credits only; participants have no financial stake in the outcome.",
  "The LMSR market price is not a calibrated probability.",
  "Participants are self-selected and may not be representative of informed opinion.",
  "The model may use this firm's matching sponsor-provided inputs; those inputs are unverified.",
  "Historical movements can reflect a small number of large allocations rather than broad consensus.",
];

export const ACTIVE_ORG_COOKIE = "vc_org";
