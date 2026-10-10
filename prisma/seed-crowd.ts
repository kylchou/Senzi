// Simulated forecaster crowd for `npm run db:seed`. Every person here is
// fictional. All randomness comes from the seed's PRNG, so runs are identical.
//
// Participation figures follow public data from forecasting platforms:
// - Metaculus questions average about 82 forecasters (5th percentile about 24,
//   95th about 166), with about 2 predictions per forecaster
//   (community analysis on the EA Forum, "Exploring Metaculus' community
//   predictions").
// - Most Manifold markets have fewer than 50 unique traders, and calibration
//   stops improving past roughly 10 to 20 traders.
// - Participation is highly unequal (Nielsen's 90-9-1 rule): a small share of
//   users places most forecasts, and stake sizes are right-skewed (Kalshi and
//   Polymarket trade-size studies: small median trade, long tail).
// The crowd is larger than a new product would have, so per-market counts sit
// a little above the Metaculus average, in the range of a popular question.

/** Simulated accounts. "A couple thousand" registered forecasters for demos. */
export const CROWD_SIZE = 2_000;

/** Median and spread of unique forecasters per public market (log-normal). */
export const FORECASTERS_PER_MARKET = { median: 110, sigma: 0.5, min: 35, max: 360 };

/** Share of the crowd verified as actual users of a given startup's product. */
export const VERIFIED_RATE = 0.04;
/** Verified users are more likely to forecast on their startup's markets. */
export const VERIFIED_INTEREST = 2;

/** Median stake in credits (log-normal, right-skewed) out of a 1,000 credit grant. */
export const STAKE = { median: 35, sigma: 0.85, min: 5, max: 500, step: 5 };

const FIRST = [
  "Amara", "Ben", "Chloe", "Diego", "Elif", "Farah", "Gabriel", "Hana", "Isaac", "Jia", "Kofi", "Laila", "Mateo",
  "Nadia", "Oscar", "Priyanka", "Quinn", "Rafael", "Sana", "Tomas", "Uma", "Victor", "Wen", "Ximena", "Yusuf",
  "Zara", "Aiko", "Bruno", "Camila", "Dmitri", "Esther", "Femi", "Grace", "Hiro", "Ines", "Jamal", "Keira", "Luca",
  "Maya", "Nikhil", "Olivia", "Pedro", "Rania", "Sofia", "Tariq", "Valentina", "Will", "Yara", "Ana", "Ethan",
  "Mei", "Noah", "Aaliyah", "Arjun", "Leah", "Kenji", "Fatima", "Marcus", "Sienna", "Omar",
];
const LAST = [
  "Adeyemi", "Bauer", "Chen", "Dubois", "Eriksen", "Fernandes", "Garcia", "Haddad", "Ito", "Jensen", "Kowalski",
  "Lee", "Mensah", "Novak", "Okafor", "Patel", "Quintero", "Rossi", "Silva", "Tanaka", "Usman", "Vargas", "Weber",
  "Xu", "Yilmaz", "Zhang", "Ahmed", "Brooks", "Costa", "Das", "Evans", "Fischer", "Gupta", "Hughes", "Ivanova",
  "Kim", "Lopez", "Morales", "Nguyen", "Ortiz", "Park", "Reyes", "Singh", "Torres", "Wright", "Yamada", "Moreau",
  "Rahman", "Santos", "Murphy",
];

export interface CrowdUser {
  handle: string;
  displayName: string;
  /** Relative activity. Heavy-tailed, so a few users place many forecasts. */
  activity: number;
}

/** Standard normal draw (Box-Muller) from the seed's uniform PRNG. */
export function normal(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function crowdUsers(random: () => number, size = CROWD_SIZE): CrowdUser[] {
  const used = new Set<string>();
  return Array.from({ length: size }, () => {
    const first = FIRST[Math.floor(random() * FIRST.length)]!;
    const last = LAST[Math.floor(random() * LAST.length)]!;
    const base = `${first}.${last}`.toLowerCase();
    let handle = base;
    for (let n = 2; used.has(handle); n++) handle = `${base}${n}`;
    used.add(handle);
    // Log-normal activity (sigma 1.1): a small share of users places a large share of forecasts.
    return { handle, displayName: `${first} ${last}`, activity: Math.exp(1.1 * normal(random)) };
  });
}

/** For each startup, the crowd members verified as users of its product. */
export function verifiedUsers(users: CrowdUser[], startups: string[], random: () => number): Map<string, Set<string>> {
  return new Map(startups.map((slug) => [slug, new Set(users.filter(() => random() < VERIFIED_RATE).map((u) => u.handle))]));
}

/** How many unique forecasters a public market attracts. */
export function forecasterTarget(random: () => number, daysOpen: number): number {
  const { median, sigma, min, max } = FORECASTERS_PER_MARKET;
  // Markets open longer have had more time to collect forecasters.
  const age = clamp(daysOpen / 50, 0.7, 1.4);
  return Math.round(clamp(median * Math.exp(sigma * normal(random)) * age, min, max));
}

/**
 * Weighted sample without replacement (Efraimidis-Spirakis): active users and
 * the startup's verified users are more likely to show up.
 */
export function pickForecasters(
  users: CrowdUser[],
  count: number,
  verified: Set<string>,
  random: () => number,
): CrowdUser[] {
  return users
    .map((user) => {
      const weight = user.activity * (verified.has(user.handle) ? VERIFIED_INTEREST : 1);
      return { user, key: Math.pow(Math.max(random(), 1e-12), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map(({ user }) => user);
}

/** Forecasts per forecaster on one market: usually one, active users sometimes add more. */
export function forecastsFor(user: CrowdUser, random: () => number): number {
  const repeat = clamp(0.12 + 0.08 * Math.log(user.activity + 1), 0.05, 0.4);
  let count = 1;
  while (count < 4 && random() < repeat) count++;
  return count;
}

/**
 * When a forecast arrives: a burst after the market opens, a smaller burst
 * after news about the startup, and a steady trickle in between.
 */
export function arrivalTime(random: () => number, opensAt: number, windowEnd: number, newsAt: number[]): number {
  const day = 86_400_000;
  const roll = random();
  let time: number;
  const news = newsAt.filter((t) => t > opensAt && t < windowEnd);
  if (roll < 0.3) time = opensAt - Math.log(Math.max(random(), 1e-9)) * 4 * day;
  else if (roll < 0.45 && news.length) time = news[Math.floor(random() * news.length)]! - Math.log(Math.max(random(), 1e-9)) * 2 * day;
  else time = opensAt + random() * (windowEnd - opensAt);
  return clamp(time, opensAt + 60_000, windowEnd - 60_000);
}

/** Stake in whole credits, right-skewed, never more than the user can afford. */
export function stakeFor(random: () => number, balance: number): number {
  const { median, sigma, min, max, step } = STAKE;
  const raw = clamp(median * Math.exp(sigma * normal(random)), min, max);
  const affordable = balance - (balance % step);
  return Math.min(Math.round(raw / step) * step, affordable);
}

/**
 * What a forecaster believes the YES probability is. The crowd centers on the
 * market's hidden lean with real disagreement; verified product users are
 * better informed (less noise, and for resolved markets a lean toward the
 * actual outcome).
 */
export function beliefFor(random: () => number, lean: number, verified: boolean, outcome: 0 | 1 | null): number {
  if (!verified) return clamp(lean + 0.16 * normal(random), 0.03, 0.97);
  const informed = outcome === null ? lean : lean + 0.25 * (outcome - lean);
  return clamp(informed + 0.08 * normal(random), 0.03, 0.97);
}

// ---------------------------------------------------------------------------
// Market discussion (demo comments)
//
// Comments are opinions about the forecast and questions about the rules.
// None states a fact about a company or claims first-hand experience, since
// some seeded companies are real.

export interface SeedComment {
  handle: string;
  body: string;
  at: number;
  replies: { handle: string; body: string; at: number }[];
}

const OPENERS_YES = [
  "Leaning YES here. The deadline leaves a reasonable amount of room.",
  "I think the crowd is underpricing this one. Took a small YES position.",
  "YES for me, but sized small. Happy to be talked out of it.",
  "The criteria look achievable within the window. Going YES.",
  "Moved from NO to YES after rereading how this resolves.",
];
const OPENERS_NO = [
  "Leaning NO. Timelines like this usually slip.",
  "The bar in the criteria is higher than the question makes it sound. NO for now.",
  "NO from me. I'd want to see more public signals before betting on it.",
  "Feels a few points too high at the moment, so I'm on NO.",
  "Taking NO. Deadlines this tight rarely hold.",
];
const OPENERS_NEUTRAL = [
  "Has anyone checked whether a partial announcement would count under these criteria?",
  "Holding off until there is more news. Curious what others are watching for.",
  "The opening baseline seems about right to me. Not sure the crowd has a real edge yet.",
  "Worth reading the NO criteria closely before forecasting. They are stricter than they look.",
  "What source would settle this fastest if it happens?",
  "Interesting to compare this with the model line in Replay.",
];
const OPENERS_VERIFIED = [
  "As a product user I'm watching their changelog for anything related to this.",
  "Verified user here. Nothing I've seen in the product changes my view either way yet.",
  "Using the product doesn't tell me much about this question, but I'm leaning slightly YES.",
];
const REPLIES = [
  "Fair point, though the criteria are strict about what counts.",
  "Agreed. I'm on the same side.",
  "I read it the other way, but it's close.",
  "The sources section on this page lists what will be checked.",
  "Good question. I'd assume only a public, dated announcement counts.",
  "Same here. Waiting for the next update before adding more.",
  "Could go either way. The deadline is doing a lot of work in this question.",
];

/** A handful of comments with occasional replies for one public market. */
export function discussionFor(
  random: () => number,
  users: CrowdUser[],
  verified: Set<string>,
  lean: number,
  from: number,
  to: number,
): SeedComment[] {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const people = users.filter(() => random() < 0.02);
  const count = Math.min(people.length, 4 + Math.floor(random() * 6));
  const span = Math.max(1, to - from);
  const comments: SeedComment[] = [];
  for (let index = 0; index < count; index++) {
    const author = people[index]!;
    const isVerified = verified.has(author.handle);
    const roll = random();
    const body = isVerified && random() < 0.6
      ? pick(OPENERS_VERIFIED)
      : roll < 0.3
        ? pick(OPENERS_NEUTRAL)
        : random() < lean
          ? pick(OPENERS_YES)
          : pick(OPENERS_NO);
    const at = from + random() * span;
    const replies: SeedComment["replies"] = [];
    const replyCount = random() < 0.4 ? 1 + Math.floor(random() * 2) : 0;
    for (let r = 0; r < replyCount; r++) {
      replies.push({ handle: pick(users).handle, body: pick(REPLIES), at: at + random() * Math.max(1, to - at) * 0.3 });
    }
    comments.push({ handle: author.handle, body, at, replies: replies.sort((a, b) => a.at - b.at) });
  }
  return comments;
}
