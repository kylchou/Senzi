import { createTestDeps } from "../testing/memory";
import { createVcServices } from "../services";
import type { OrgMembership, OrgRole, Study, VcContext } from "../types";
import type { CreateStudyInput } from "../validation";

export const NOW = new Date("2026-10-01T12:00:00Z");
export const DAY = 24 * 60 * 60 * 1000;

const orgName: Record<string, string> = { org_a: "Alpha Ventures", org_b: "Beta Capital" };

export function member(organizationId: string, role: OrgRole): OrgMembership {
  return { organizationId, organizationName: orgName[organizationId] ?? organizationId, role };
}

export function ctxFor(
  userId: string,
  memberships: OrgMembership[] = [],
  opts: { isPlatformAdmin?: boolean } = {},
): VcContext {
  return {
    user: { id: userId, name: userId, email: `${userId}@example.com`, isPlatformAdmin: !!opts.isPlatformAdmin },
    memberships,
    activeOrg: memberships[0] ?? null,
  };
}

export const users = {
  ownerA: ctxFor("owner_a", [member("org_a", "OWNER")]),
  analystA: ctxFor("analyst_a", [member("org_a", "ANALYST")]),
  analystA2: ctxFor("analyst_a2", [member("org_a", "ANALYST")]),
  viewerA: ctxFor("viewer_a", [member("org_a", "VIEWER")]),
  analystB: ctxFor("analyst_b", [member("org_b", "ANALYST")]),
  outsider: ctxFor("outsider"),
  external: ctxFor("external"),
  admin: ctxFor("admin", [], { isPlatformAdmin: true }),
};

const SLUGS: Record<string, string> = { startup_1: "acme", startup_2: "globex" };

/** A link the fake model prices (see createFakeModel): weekly downloads, after the default deadline. */
export function modelLinkFor(startupId = "startup_1", overrides: Partial<NonNullable<CreateStudyInput["modelLink"]>> = {}) {
  return { metricId: `downloads:${SLUGS[startupId]}`, threshold: 50_000, targetDate: "2027-01-15", observations: [], ...overrides };
}

export function validStudyInput(overrides: Partial<CreateStudyInput> = {}): CreateStudyInput {
  return {
    startupId: "startup_1",
    question: "Will Acme raise a Series B by June 30, 2027?",
    yesCriteria: "A Series B round of at least $20M is publicly announced.",
    noCriteria: "No qualifying round is announced by the deadline.",
    context: "Acme raised a $8M Series A in 2025.",
    deadline: new Date(NOW.getTime() + 60 * DAY),
    visibility: "ORGANIZATION",
    sources: [{ url: "https://example.com/acme-series-a", title: "Acme Series A announcement" }],
    modelLink: modelLinkFor(overrides.startupId ?? "startup_1"),
    ...overrides,
  };
}

export function setup() {
  const t = createTestDeps(NOW);
  t.platform.state.startups.push(
    { id: "startup_1", name: "Acme", slug: "acme", industry: "SaaS" },
    { id: "startup_2", name: "Globex", slug: "globex", industry: "Climate" },
  );
  t.platform.state.users.push(
    { id: "external", name: "External Expert", email: "external@example.com" },
    { id: "analyst_a2", name: "Analyst A2", email: "analyst_a2@example.com" },
  );
  t.platform.state.memberships.set("external", []);
  const services = createVcServices(t.deps);
  return { ...t, services };
}

/** Drives a study through submit → approve → open as the right actors. */
export async function openStudy(
  s: ReturnType<typeof setup>,
  input: Partial<CreateStudyInput> = {},
  author = users.analystA,
): Promise<Study> {
  const draft = await s.services.studies.create(author, validStudyInput(input));
  if (input.visibility === "RESTRICTED") {
    await s.services.studies.setParticipants(author, draft.id, { userIds: ["external"], emails: [] });
  }
  let st = (await s.repo.findStudy(draft.id))!;
  await s.services.studies.transition(author, st.id, { action: "submit", expectedVersion: st.version });
  st = (await s.repo.findStudy(draft.id))!;
  await s.services.studies.transition(users.admin, st.id, { action: "approve", expectedVersion: st.version });
  st = (await s.repo.findStudy(draft.id))!;
  await s.services.studies.transition(users.admin, st.id, { action: "open", expectedVersion: st.version });
  return (await s.repo.findStudy(draft.id))!;
}
