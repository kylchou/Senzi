import { conflict, notFound } from "@/lib/api-response";
import { db, isUniqueViolation } from "@/lib/db";
import { PENDING_AUTH_PREFIX, type CurrentUserResponse, type PublicUserProfile, type SessionUser } from "@/lib/types";
import type { UpdateProfileInput } from "@/lib/validation";
import { listMyOrganizations } from "@/lib/organizations";

export async function getCurrentUserProfile(user: SessionUser): Promise<CurrentUserResponse> {
  const [row, memberships] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { bio: true, creditBalance: true, createdAt: true },
    }),
    listMyOrganizations(user),
  ]);
  return {
    ...user,
    bio: row.bio,
    creditBalance: row.creditBalance,
    memberships,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function updateProfile(user: SessionUser, input: UpdateProfileInput) {
  try {
    await db.user.update({ where: { id: user.id }, data: input });
  } catch (error) {
    if (isUniqueViolation(error, "username")) throw conflict("That username is taken");
    throw error;
  }
  const refreshed = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { id: true, authId: true, email: true, username: true, displayName: true, avatarUrl: true, platformRole: true },
  });
  return getCurrentUserProfile(refreshed);
}

/** Public profile by username or id. Never exposes email or balance. */
export async function getPublicProfile(usernameOrId: string): Promise<PublicUserProfile> {
  const user = await db.user.findFirst({
    where: {
      OR: [{ username: usernameOrId.toLowerCase() }, { id: usernameOrId }],
      NOT: [{ authId: { startsWith: PENDING_AUTH_PREFIX } }, { authId: { startsWith: "deleted:" } }],
    },
    select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, createdAt: true },
  });
  if (!user) throw notFound("User");
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export async function listNotifications(
  user: SessionUser,
  { unreadOnly, cursor, limit }: { unreadOnly: boolean; cursor?: string; limit: number },
) {
  const rows = await db.notification.findMany({
    where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

/** Marks the given notifications (or all of them) read. Only touches the caller's rows. */
export async function markNotificationsRead(user: SessionUser, ids: string[] | "all") {
  const { count } = await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return count;
}

/**
 * Called when the auth provider deletes an account. Ledger and forecast rows
 * must survive for auditing, so the user row is anonymized instead of deleted.
 */
export async function anonymizeDeletedUser(authId: string) {
  const user = await db.user.findUnique({ where: { authId }, select: { id: true } });
  if (!user) return;
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        authId: `deleted:${user.id}`,
        email: `deleted+${user.id}@users.senzi.invalid`,
        username: null,
        displayName: "Deleted user",
        avatarUrl: null,
        bio: null,
      },
    }),
    db.organizationMembership.deleteMany({ where: { userId: user.id } }),
    db.studyParticipant.deleteMany({ where: { userId: user.id } }),
  ]);
}

/** Keeps the cached profile fields in sync when the auth provider reports a change. */
export async function syncProfileFromAuth(
  authId: string,
  fields: { email: string; displayName: string; avatarUrl: string | null },
) {
  await db.user.updateMany({
    where: { authId },
    data: { email: fields.email.toLowerCase(), displayName: fields.displayName, avatarUrl: fields.avatarUrl },
  });
}
