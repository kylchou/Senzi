/** VC Intelligence section links, shared by the static shell and the client nav. */
export interface VcNavLink {
  href: string;
  label: string;
  exact: boolean;
  /** Other paths that belong to this tab. */
  also?: readonly string[];
}

export const VC_LINKS: readonly VcNavLink[] = [
  { href: "/vc", label: "Dashboard", exact: true },
  { href: "/vc/studies", label: "Questions", exact: false },
  // Following, company detail and comparisons all live under Companies.
  { href: "/vc/companies", label: "Companies", exact: false, also: ["/vc/compare", "/vc/watchlists"] },
];

export const REVIEW_LINK: VcNavLink = { href: "/vc/review", label: "Review queue", exact: false };

export function isActiveLink(link: VcNavLink, pathname: string): boolean {
  if (link.exact) return pathname === link.href;
  return [link.href, ...(link.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
