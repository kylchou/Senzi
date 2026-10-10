// Demo content for `npm run db:seed`. Every company, person, and article here
// is fictional. Dates are offsets in days from SEED_ANCHOR so the data is
// identical on every run.

import type { StartupStage } from "../generated/prisma/enums";

export const SEED_ANCHOR = new Date("2026-10-01T16:00:00.000Z");

export interface SeedStartup {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  industry: string;
  stage: StartupStage;
  foundedYear: number;
  headquarters: string;
}

export const startups: SeedStartup[] = [
  { slug: "lumen-grid", name: "Lumen Grid", tagline: "Grid-scale iron-air storage", description: "Builds 100-hour iron-air batteries for utilities.", industry: "Climate", stage: "SERIES_B", foundedYear: 2020, headquarters: "Boston, MA" },
  { slug: "tessellate-bio", name: "Tessellate Bio", tagline: "Protein design for enzyme therapies", description: "Uses generative models to design stable therapeutic enzymes.", industry: "Biotech", stage: "SERIES_A", foundedYear: 2021, headquarters: "South San Francisco, CA" },
  { slug: "quayside", name: "Quayside", tagline: "Freight booking for short-sea shipping", description: "A marketplace that matches European shippers with coastal vessels.", industry: "Logistics", stage: "SEED", foundedYear: 2023, headquarters: "Rotterdam, NL" },
  { slug: "ledgerline", name: "Ledgerline", tagline: "Close the books in a day", description: "Accounting automation for mid-market finance teams.", industry: "Fintech", stage: "SERIES_C", foundedYear: 2018, headquarters: "New York, NY" },
  { slug: "northwind-robotics", name: "Northwind Robotics", tagline: "Autonomous forklifts for cold storage", description: "Robots that work in -25°C warehouses without human operators.", industry: "Robotics", stage: "SERIES_B", foundedYear: 2019, headquarters: "Pittsburgh, PA" },
  { slug: "parcelpilot", name: "ParcelPilot", tagline: "Same-day delivery APIs for retailers", description: "Routing and courier orchestration for regional retailers.", industry: "Logistics", stage: "SERIES_A", foundedYear: 2021, headquarters: "Austin, TX" },
  { slug: "verdant-soil", name: "Verdant Soil", tagline: "Soil carbon measurement at scale", description: "Remote sensing plus sampling to verify soil carbon credits.", industry: "Climate", stage: "SEED", foundedYear: 2022, headquarters: "Des Moines, IA" },
  { slug: "cobalt-health", name: "Cobalt Health", tagline: "Remote cardiac monitoring", description: "Wearable patches and a care team for post-operative heart patients.", industry: "Healthcare", stage: "SERIES_B", foundedYear: 2019, headquarters: "Nashville, TN" },
  { slug: "stackwise", name: "Stackwise", tagline: "Cost observability for AI workloads", description: "Tracks and forecasts GPU and inference spend across clouds.", industry: "Developer tools", stage: "SERIES_A", foundedYear: 2022, headquarters: "San Francisco, CA" },
  { slug: "harborview-energy", name: "Harborview Energy", tagline: "Offshore wind maintenance drones", description: "Inspection and repair drones for offshore turbines.", industry: "Climate", stage: "SERIES_A", foundedYear: 2021, headquarters: "Aberdeen, UK" },
  { slug: "kindred-learning", name: "Kindred Learning", tagline: "Tutoring copilots for teachers", description: "Classroom tools that turn lesson plans into individual practice.", industry: "Education", stage: "SEED", foundedYear: 2023, headquarters: "Chicago, IL" },
  { slug: "meridian-pay", name: "Meridian Pay", tagline: "Cross-border payroll in stablecoins", description: "Payroll for remote contractors in 60 countries.", industry: "Fintech", stage: "SERIES_B", foundedYear: 2020, headquarters: "Miami, FL" },
  { slug: "fieldnote", name: "Fieldnote", tagline: "Voice notes to CRM for field sales", description: "Turns sales reps' voice memos into structured CRM updates.", industry: "Software", stage: "SEED", foundedYear: 2024, headquarters: "Denver, CO" },
  { slug: "orbital-loom", name: "Orbital Loom", tagline: "In-orbit manufacturing of optical fiber", description: "Makes ZBLAN fiber in microgravity aboard small satellites.", industry: "Space", stage: "SERIES_A", foundedYear: 2020, headquarters: "Los Angeles, CA" },
  { slug: "brightside-foods", name: "Brightside Foods", tagline: "Fermented dairy-free cheese", description: "Precision-fermented casein for plant-based cheese makers.", industry: "Food", stage: "SERIES_A", foundedYear: 2021, headquarters: "Oakland, CA" },
  { slug: "sentinel-ops", name: "Sentinel Ops", tagline: "Incident response for small security teams", description: "Automated triage and playbooks for companies without a SOC.", industry: "Security", stage: "SERIES_B", foundedYear: 2019, headquarters: "Washington, DC" },
  { slug: "tidewater-water", name: "Tidewater", tagline: "Modular desalination", description: "Container-sized solar desalination units for island communities.", industry: "Climate", stage: "SEED", foundedYear: 2023, headquarters: "San Diego, CA" },
  { slug: "atlas-claims", name: "Atlas Claims", tagline: "Faster property insurance claims", description: "Photo-based damage estimates for home insurers.", industry: "Insurtech", stage: "SERIES_C", foundedYear: 2017, headquarters: "Columbus, OH" },
  { slug: "polymath-labs", name: "Polymath Labs", tagline: "Lab automation for small biotechs", description: "Rentable robotic benches with a scheduling API.", industry: "Biotech", stage: "SEED", foundedYear: 2024, headquarters: "Cambridge, MA" },
  { slug: "copperline-ev", name: "Copperline", tagline: "Fleet EV charging as a service", description: "Depot charging installs and energy management for delivery fleets.", industry: "Climate", stage: "SERIES_A", foundedYear: 2021, headquarters: "Atlanta, GA" },
];

export type SeedMarketState = "OPEN" | "DRAFT" | "CLOSED" | "RESOLVED_YES" | "RESOLVED_NO" | "CANCELLED";

export interface SeedMarket {
  slug: string;
  startup: string;
  question: string;
  criteria: string;
  source: string;
  category: string;
  baseline: number;
  state: SeedMarketState;
  /** Deadline as days from SEED_ANCHOR (negative = already passed). */
  closesInDays: number;
  visibility?: "PUBLIC" | "ORGANIZATION" | "RESTRICTED";
  /** Hidden "true" probability that seeded forecasters lean toward. */
  lean: number;
}

export const markets: SeedMarket[] = [
  { slug: "lumen-grid-series-c-2027", startup: "lumen-grid", question: "Will Lumen Grid announce a Series C of at least $150M by June 30, 2027?", criteria: "YES if Lumen Grid or a lead investor publicly announces a priced Series C of $150M or more on or before 2027-06-30 (UTC).", source: "Company press releases, lead investor announcements", category: "Funding", baseline: 0.45, state: "OPEN", closesInDays: 270, lean: 0.55 },
  { slug: "lumen-grid-utility-contract", startup: "lumen-grid", question: "Will Lumen Grid sign a utility contract above 1 GWh before April 2027?", criteria: "YES if a signed contract for at least 1 GWh of storage capacity with a regulated utility is publicly disclosed before 2027-04-01.", source: "Utility regulatory filings, company announcements", category: "Commercial", baseline: 0.35, state: "OPEN", closesInDays: 180, lean: 0.3 },
  { slug: "tessellate-ind-filing", startup: "tessellate-bio", question: "Will Tessellate Bio file an IND for its lead enzyme program by March 31, 2027?", criteria: "YES if Tessellate Bio publicly confirms an Investigational New Drug application submitted to the FDA on or before 2027-03-31.", source: "Company press releases, FDA communications", category: "Regulatory", baseline: 0.4, state: "OPEN", closesInDays: 175, lean: 0.48 },
  { slug: "tessellate-pharma-partnership", startup: "tessellate-bio", question: "Will Tessellate Bio announce a pharma partnership worth $50M+ upfront in 2026?", criteria: "YES if a partnership with at least $50M in disclosed upfront payment is announced between 2026-01-01 and 2026-12-31.", source: "Company and partner press releases", category: "Partnerships", baseline: 0.2, state: "OPEN", closesInDays: 90, lean: 0.12 },
  { slug: "quayside-seed-extension", startup: "quayside", question: "Will Quayside close a seed extension or Series A by January 31, 2027?", criteria: "YES if Quayside publicly announces new priced equity funding (seed extension or Series A) on or before 2027-01-31.", source: "Company announcements, Dutch Chamber of Commerce filings", category: "Funding", baseline: 0.5, state: "OPEN", closesInDays: 120, lean: 0.62 },
  { slug: "ledgerline-ipo-filing", startup: "ledgerline", question: "Will Ledgerline publicly file an S-1 before the end of 2027?", criteria: "YES if an S-1 (or F-1) registration statement for Ledgerline appears on SEC EDGAR on or before 2027-12-31.", source: "SEC EDGAR", category: "Exit", baseline: 0.25, state: "OPEN", closesInDays: 455, lean: 0.3 },
  { slug: "ledgerline-arr-200m", startup: "ledgerline", question: "Will Ledgerline report $200M ARR by its fiscal year end 2026?", criteria: "YES if Ledgerline or its CEO publicly states ARR of at least $200M as of fiscal year end 2026, disclosed before 2027-03-31.", source: "Company statements, executive interviews on record", category: "Growth", baseline: 0.4, state: "OPEN", closesInDays: 180, lean: 0.44 },
  { slug: "northwind-1000-units", startup: "northwind-robotics", question: "Will Northwind Robotics announce 1,000 deployed forklifts by June 2027?", criteria: "YES if Northwind publicly states at least 1,000 autonomous forklifts in commercial deployment on or before 2027-06-30.", source: "Company announcements", category: "Commercial", baseline: 0.3, state: "OPEN", closesInDays: 270, lean: 0.36 },
  { slug: "parcelpilot-acquired", startup: "parcelpilot", question: "Will ParcelPilot be acquired before the end of 2027?", criteria: "YES if a definitive agreement for the acquisition of a majority of ParcelPilot is publicly announced on or before 2027-12-31.", source: "Company and acquirer announcements", category: "Exit", baseline: 0.15, state: "OPEN", closesInDays: 455, lean: 0.18 },
  { slug: "parcelpilot-new-metros", startup: "parcelpilot", question: "Will ParcelPilot launch in 10 new metro areas by March 2027?", criteria: "YES if ParcelPilot's public coverage map or announcements show at least 10 new US metro areas added after 2026-10-01 and before 2027-03-31.", source: "Company website coverage map, press releases", category: "Growth", baseline: 0.4, state: "OPEN", closesInDays: 175, lean: 0.5 },
  { slug: "verdant-registry-approval", startup: "verdant-soil", question: "Will Verdant Soil's methodology be approved by a major carbon registry by mid-2027?", criteria: "YES if Verra, Gold Standard, or Climate Action Reserve publicly approves a Verdant Soil measurement methodology on or before 2027-06-30.", source: "Registry public methodology listings", category: "Regulatory", baseline: 0.3, state: "OPEN", closesInDays: 270, lean: 0.26 },
  { slug: "cobalt-fda-clearance", startup: "cobalt-health", question: "Will Cobalt Health receive FDA 510(k) clearance for its v2 patch by April 2027?", criteria: "YES if the FDA 510(k) database lists a clearance for Cobalt Health's second-generation cardiac patch with a decision date on or before 2027-04-30.", source: "FDA 510(k) database", category: "Regulatory", baseline: 0.55, state: "OPEN", closesInDays: 210, lean: 0.64 },
  { slug: "stackwise-series-b", startup: "stackwise", question: "Will Stackwise announce a Series B by March 31, 2027?", criteria: "YES if Stackwise publicly announces a priced Series B round on or before 2027-03-31.", source: "Company announcements, lead investor posts", category: "Funding", baseline: 0.45, state: "OPEN", closesInDays: 175, lean: 0.58 },
  { slug: "harborview-uk-contract", startup: "harborview-energy", question: "Will Harborview Energy sign a maintenance contract with a UK wind farm operator in 2026?", criteria: "YES if a commercial (non-pilot) maintenance contract with an operator of a UK offshore wind farm is announced between 2026-01-01 and 2026-12-31.", source: "Company and operator announcements", category: "Commercial", baseline: 0.35, state: "OPEN", closesInDays: 90, lean: 0.4 },
  { slug: "kindred-district-deals", startup: "kindred-learning", question: "Will Kindred Learning be adopted by 50 US school districts by August 2027?", criteria: "YES if Kindred Learning publicly reports paid adoption by at least 50 US public school districts on or before 2027-08-31.", source: "Company announcements, district procurement records", category: "Growth", baseline: 0.3, state: "OPEN", closesInDays: 330, lean: 0.33 },
  { slug: "meridian-license", startup: "meridian-pay", question: "Will Meridian Pay obtain an EU e-money license by June 2027?", criteria: "YES if Meridian Pay or a subsidiary appears as an authorized e-money institution in an EU national regulator register on or before 2027-06-30.", source: "EU national regulator registers", category: "Regulatory", baseline: 0.4, state: "OPEN", closesInDays: 270, lean: 0.42 },
  { slug: "fieldnote-salesforce-app", startup: "fieldnote", question: "Will Fieldnote launch on the Salesforce AppExchange before 2027?", criteria: "YES if a Fieldnote listing is publicly live on the Salesforce AppExchange on or before 2026-12-31.", source: "Salesforce AppExchange", category: "Product", baseline: 0.5, state: "OPEN", closesInDays: 90, lean: 0.67 },
  { slug: "orbital-loom-second-flight", startup: "orbital-loom", question: "Will Orbital Loom launch its second production satellite by September 2027?", criteria: "YES if a second Orbital Loom manufacturing satellite reaches orbit on or before 2027-09-30, per launch provider manifests or company confirmation.", source: "Launch provider manifests, company announcements", category: "Product", baseline: 0.35, state: "OPEN", closesInDays: 365, lean: 0.3 },
  { slug: "brightside-retail", startup: "brightside-foods", question: "Will Brightside Foods' cheese be sold in a top-10 US grocery chain by mid-2027?", criteria: "YES if a product containing Brightside casein is stocked by one of the ten largest US grocery chains (by revenue) on or before 2027-06-30.", source: "Retailer listings, company announcements", category: "Commercial", baseline: 0.3, state: "OPEN", closesInDays: 270, lean: 0.38 },
  { slug: "sentinel-soc2-customers", startup: "sentinel-ops", question: "Will Sentinel Ops announce 2,000 paying customers by March 2027?", criteria: "YES if Sentinel Ops publicly states at least 2,000 paying customers on or before 2027-03-31.", source: "Company announcements", category: "Growth", baseline: 0.45, state: "OPEN", closesInDays: 175, lean: 0.5 },
  { slug: "atlas-claims-ipo", startup: "atlas-claims", question: "Will Atlas Claims IPO or be acquired by the end of 2027?", criteria: "YES if Atlas Claims lists on a public exchange or a definitive acquisition agreement is announced on or before 2027-12-31.", source: "SEC EDGAR, exchange listings, acquirer announcements", category: "Exit", baseline: 0.25, state: "OPEN", closesInDays: 455, lean: 0.22 },
  { slug: "copperline-100-depots", startup: "copperline-ev", question: "Will Copperline operate 100 fleet charging depots by June 2027?", criteria: "YES if Copperline publicly reports at least 100 operational depot charging sites on or before 2027-06-30.", source: "Company announcements", category: "Growth", baseline: 0.35, state: "OPEN", closesInDays: 270, lean: 0.41 },

  // Opened from Northstar Ventures research studies (not public)
  { slug: "northstar-tidewater-pilot", startup: "tidewater-water", question: "Will Tidewater complete a paid pilot with an island utility before July 2027?", criteria: "YES if Tidewater confirms (publicly or to Northstar in writing) a completed paid pilot with an island utility before 2027-07-01.", source: "Company confirmation", category: "Commercial", baseline: 0.4, state: "OPEN", closesInDays: 270, visibility: "ORGANIZATION", lean: 0.45 },
  { slug: "northstar-polymath-seed", startup: "polymath-labs", question: "Will Polymath Labs raise a seed round of $8M+ by April 2027?", criteria: "YES if Polymath Labs closes priced seed financing of at least $8M on or before 2027-04-30, per company announcement or Form D.", source: "SEC Form D, company announcements", category: "Funding", baseline: 0.5, state: "OPEN", closesInDays: 210, visibility: "RESTRICTED", lean: 0.55 },

  // Drafts
  { slug: "tidewater-second-site", startup: "tidewater-water", question: "Will Tidewater deploy units at a second island site in 2027?", criteria: "YES if Tidewater units are publicly confirmed operating at a second distinct island site between 2027-01-01 and 2027-12-31.", source: "Company announcements", category: "Commercial", baseline: 0.4, state: "DRAFT", closesInDays: 455, lean: 0.4 },
  { slug: "polymath-public-api", startup: "polymath-labs", question: "Will Polymath Labs open its scheduling API to the public by March 2027?", criteria: "YES if Polymath Labs' scheduling API is publicly documented and available without a waitlist on or before 2027-03-31.", source: "Company developer docs", category: "Product", baseline: 0.5, state: "DRAFT", closesInDays: 175, lean: 0.5 },

  // Past deadline, awaiting resolution
  { slug: "quayside-north-sea-route", startup: "quayside", question: "Will Quayside launch a North Sea route by September 30, 2026?", criteria: "YES if Quayside lists bookable North Sea sailings on its platform on or before 2026-09-30.", source: "Quayside booking platform, company announcements", category: "Product", baseline: 0.5, state: "CLOSED", closesInDays: -1, lean: 0.6 },
  { slug: "stackwise-soc2", startup: "stackwise", question: "Will Stackwise announce SOC 2 Type II compliance by September 2026?", criteria: "YES if Stackwise publicly states it holds a SOC 2 Type II report dated on or before 2026-09-30.", source: "Company trust page, announcements", category: "Security", baseline: 0.6, state: "CLOSED", closesInDays: -2, lean: 0.7 },

  // Resolved (settlement pending, for the forecasting engine to process)
  { slug: "cobalt-series-c-q3", startup: "cobalt-health", question: "Will Cobalt Health announce a Series C in Q3 2026?", criteria: "YES if Cobalt Health publicly announces a priced Series C between 2026-07-01 and 2026-09-30.", source: "Company press releases", category: "Funding", baseline: 0.35, state: "RESOLVED_YES", closesInDays: -10, lean: 0.6 },
  { slug: "meridian-100k-contractors", startup: "meridian-pay", question: "Will Meridian Pay report 100,000 paid contractors by September 2026?", criteria: "YES if Meridian Pay publicly states at least 100,000 contractors paid in a single month on or before 2026-09-30.", source: "Company announcements", category: "Growth", baseline: 0.4, state: "RESOLVED_NO", closesInDays: -12, lean: 0.35 },
  { slug: "harborview-norway-trial", startup: "harborview-energy", question: "Will Harborview Energy start a Norwegian offshore trial by August 2026?", criteria: "YES if Harborview confirms drones operating at a Norwegian offshore wind site on or before 2026-08-31.", source: "Company announcements", category: "Commercial", baseline: 0.5, state: "CANCELLED", closesInDays: -20, lean: 0.5 },
];

export const users = [
  { handle: "avery", displayName: "Avery Admin", role: "ADMIN" as const },
  { handle: "maya", displayName: "Maya Okafor" },
  { handle: "theo", displayName: "Theo Lindqvist" },
  { handle: "priya", displayName: "Priya Raman" },
  { handle: "jonas", displayName: "Jonas Becker" },
  { handle: "lena", displayName: "Lena Duarte" },
  { handle: "sam", displayName: "Sam Whitfield" },
  { handle: "ines", displayName: "Inês Carvalho" },
  { handle: "dev", displayName: "Dev Malhotra" },
  { handle: "rosa", displayName: "Rosa Nakamura" },
  { handle: "omar", displayName: "Omar Haddad" },
  { handle: "kit", displayName: "Kit Morales" },
];

export const news = [
  { startup: "lumen-grid", title: "Lumen Grid opens pilot plant in Massachusetts", sourceName: "Senzi demo wire", days: -20, verified: true },
  { startup: "tessellate-bio", title: "Tessellate Bio presents preclinical enzyme data", sourceName: "Senzi demo wire", days: -14, verified: true },
  { startup: "ledgerline", title: "Report: Ledgerline interviewing IPO banks", sourceName: "Demo Business Daily", days: -9, verified: false },
  { startup: "cobalt-health", title: "Cobalt Health raises Series C", sourceName: "Senzi demo wire", days: -12, verified: true },
  { startup: "stackwise", title: "Stackwise adds per-team GPU budgets", sourceName: "Demo Tech Journal", days: -6, verified: true },
  { startup: "meridian-pay", title: "Meridian Pay contractor growth slows, sources say", sourceName: "Demo Business Daily", days: -15, verified: false },
  { startup: "quayside", title: "Quayside teases North Sea sailings", sourceName: "Demo Logistics Weekly", days: -25, verified: false },
  { startup: "northwind-robotics", title: "Northwind Robotics deploys at second cold-chain customer", sourceName: "Senzi demo wire", days: -30, verified: true },
  { startup: "brightside-foods", title: "Brightside Foods in talks with national grocers", sourceName: "Demo Food Business", days: -4, verified: false },
  { startup: "harborview-energy", title: "Harborview pauses Norway plans after permit delay", sourceName: "Demo Energy Monitor", days: -22, verified: true },
  { startup: "orbital-loom", title: "Orbital Loom's first satellite returns fiber samples", sourceName: "Senzi demo wire", days: -40, verified: true },
  { startup: "sentinel-ops", title: "Sentinel Ops launches free tier for startups", sourceName: "Demo Tech Journal", days: -3, verified: true },
];

export const achievements = [
  { key: "first-forecast", name: "First forecast", description: "Placed your first forecast.", creditReward: 50 },
  { key: "ten-forecasts", name: "Regular", description: "Placed ten forecasts.", creditReward: 100 },
  { key: "first-correct", name: "Called it", description: "Your first forecast on a market that resolved your way.", creditReward: 100 },
  { key: "early-bird", name: "Early bird", description: "Forecast within a day of a market opening.", creditReward: 25 },
  { key: "well-calibrated", name: "Well calibrated", description: "Strong calibration across 20 resolved forecasts.", creditReward: 250 },
];

/** Sourced facts shown on startup pages. `verified` = an admin checked the source. */
export const facts = [
  { startup: "lumen-grid", label: "Total funding", value: "$212M", sourceName: "Company press release", days: -60, verified: true },
  { startup: "lumen-grid", label: "Employees", value: "~180", sourceName: "Careers page", days: -15, verified: false },
  { startup: "ledgerline", label: "Customers", value: "4,000+", sourceName: "Company website", days: -30, verified: false },
  { startup: "ledgerline", label: "Last round", value: "Series C, $140M", sourceName: "Company press release", days: -400, verified: true },
  { startup: "cobalt-health", label: "Last round", value: "Series C", sourceName: "Company press release", days: -12, verified: true },
  { startup: "stackwise", label: "Open-source stars", value: "11.2k", sourceName: "GitHub", days: -2, verified: true },
  { startup: "meridian-pay", label: "Countries supported", value: "60", sourceName: "Company website", days: -20, verified: false },
  { startup: "northwind-robotics", label: "Deployed units", value: "~350", sourceName: "CEO interview", days: -45, verified: false },
];
