/** VC Intelligence section links, shared by the static shell and the client nav. */
export const VC_LINKS = [
  { href: "/vc", label: "Dashboard", exact: true },
  { href: "/vc/studies", label: "My questions", exact: false },
  { href: "/vc/companies", label: "Companies", exact: false },
  { href: "/vc/watchlists", label: "Watchlists", exact: false },
  { href: "/vc/compare", label: "Compare", exact: false },
  { href: "/vc/alerts", label: "Alerts", exact: false },
  { href: "/vc/reports", label: "Reports", exact: false },
] as const;

export const REVIEW_LINK = { href: "/vc/review", label: "Review queue", exact: false } as const;
