import "server-only";
import { cache } from "react";
import { notFound as notFoundPage } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { UserJSON } from "@clerk/nextjs/server";
import { AccountType, PlatformRole } from "@/generated/prisma/enums";
import { conflict, forbidden, unauthenticated } from "@/lib/api-response";
import { grantSignupCredits } from "@/lib/credits";
import { db, isUniqueViolation } from "@/lib/db";
import { PENDING_AUTH_PREFIX, type SessionUser } from "@/lib/types";

/**
 * Authentication (Clerk) -> Senzi user resolution.
 *
 * Clerk is the only identity provider. Every server-side check goes through
 * getCurrentUser()/requireUser()/requirePlatformAdmin(); nothing trusts
 * client-supplied user ids. Only getAuthIdentity() and the Clerk webhook
 * talk to Clerk directly, so swapping providers touches this file only.
 */

export type { SessionUser };

export { PENDING_AUTH_PREFIX };

const sessionUserSelect = {
  id: true,
  authId: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  platformRole: true,
  accountType: true,
  accountVerifiedAt: true,
} as const;

export interface AuthIdentity {
  authId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  /** Self-declared at signup through Clerk unsafeMetadata. Null if missing or invalid. */
  accountType: AccountType | null;
}

export function parseAccountType(value: unknown): AccountType | null {
  return value === AccountType.VC || value === AccountType.TRADER ? value : null;
}

/** Traders are verified by their confirmed email. VCs wait for review (lib/verification.ts). */
function initialVerification(identity: Pick<AuthIdentity, "accountType" | "emailVerified">): Date | null {
  return identity.accountType === AccountType.TRADER && identity.emailVerified ? new Date() : null;
}

/** Emails in SENZI_ADMIN_EMAILS become platform admins on first sign-in. */
export function isBootstrapAdminEmail(email: string, raw = process.env.SENZI_ADMIN_EMAILS ?? ""): boolean {
  const target = email.trim().toLowerCase();
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry !== "" && entry === target);
}

/**
 * Finds or creates the Senzi user for a verified identity. Handles:
 * - returning users (matched by authId)
 * - invited users (a pending placeholder with the same verified email is claimed)
 * - brand-new users (created with the one-time signup credit grant)
 * Safe under concurrent first requests.
 */
export async function provisionUser(identity: AuthIdentity): Promise<SessionUser> {
  const email = identity.email.trim().toLowerCase();
  const makeAdmin = isBootstrapAdminEmail(email);

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { authId: identity.authId },
        select: sessionUserSelect,
      });
      if (existing) return existing;

      const byEmail = await tx.user.findUnique({ where: { email }, select: { id: true, authId: true } });
      // A concurrent first request for this same identity committed between the two reads.
      if (byEmail?.authId === identity.authId) {
        return tx.user.findUniqueOrThrow({ where: { id: byEmail.id }, select: sessionUserSelect });
      }
      let userId: string;
      if (byEmail) {
        if (identity.accountType) {
          await tx.user.updateMany({
            where: { id: byEmail.id, accountType: null },
            data: { accountType: identity.accountType, accountVerifiedAt: initialVerification(identity) },
          });
        }
        if (!byEmail.authId.startsWith(PENDING_AUTH_PREFIX) || !identity.emailVerified) {
          throw conflict("This email is already linked to another account");
        }
        await tx.user.update({
          where: { id: byEmail.id },
          data: {
            authId: identity.authId,
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            ...(makeAdmin ? { platformRole: PlatformRole.ADMIN } : {}),
          },
        });
        userId = byEmail.id;
      } else {
        const created = await tx.user.create({
          data: {
            authId: identity.authId,
            email,
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            accountType: identity.accountType,
            accountVerifiedAt: initialVerification(identity),
            platformRole: makeAdmin ? PlatformRole.ADMIN : PlatformRole.USER,
          },
          select: { id: true },
        });
        userId = created.id;
      }

      await grantSignupCredits(tx, userId);
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: sessionUserSelect });
    });
  } catch (error) {
    // Another request provisioned the same identity first.
    if (isUniqueViolation(error)) {
      const winner = await db.user.findUnique({
        where: { authId: identity.authId },
        select: sessionUserSelect,
      });
      if (winner) return winner;
    }
    throw error;
  }
}

/** Reads the signed-in identity from Clerk. Null when signed out. */
async function getAuthIdentity(): Promise<AuthIdentity | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;
  const primary = clerkUser.primaryEmailAddress;
  if (!primary) return null;
  return {
    authId: clerkUser.id,
    email: primary.emailAddress,
    emailVerified: primary.verification?.status === "verified",
    displayName:
      clerkUser.fullName?.trim() ||
      clerkUser.username ||
      primary.emailAddress.split("@")[0]!,
    avatarUrl: clerkUser.imageUrl || null,
    accountType: parseAccountType(clerkUser.unsafeMetadata?.accountType),
  };
}

/** Maps a Clerk webhook user payload to an identity. */
export function identityFromClerkUser(data: UserJSON): AuthIdentity | null {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  if (!primary) return null;
  const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return {
    authId: data.id,
    email: primary.email_address,
    emailVerified: primary.verification?.status === "verified",
    displayName: fullName || data.username || primary.email_address.split("@")[0]!,
    avatarUrl: data.image_url || null,
    accountType: parseAccountType(data.unsafe_metadata?.accountType),
  };
}

/**
 * The signed-in Senzi user, or null. Provisions the database row on first
 * sign-in. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const { userId: authId } = await auth();
  if (!authId) return null;

  const existing = await db.user.findUnique({ where: { authId }, select: sessionUserSelect });
  if (existing) return existing;

  const identity = await getAuthIdentity();
  if (!identity) return null;
  return provisionUser(identity);
});

/** For API routes and server actions: throws 401 when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

export function isPlatformAdmin(user: Pick<SessionUser, "platformRole"> | null): boolean {
  return user?.platformRole === PlatformRole.ADMIN;
}

/**
 * Sets the account type once. A no-op if it's already set, except that a trader
 * provisioned before their email was confirmed gets verified here. Signing in proves
 * Clerk verified their email, which is all a trader needs; VCs still need review.
 */
export async function chooseAccountType(user: SessionUser, type: AccountType): Promise<SessionUser> {
  await db.user.updateMany({
    where: {
      id: user.id,
      OR: [{ accountType: null }, ...(type === AccountType.TRADER ? [{ accountType: AccountType.TRADER, accountVerifiedAt: null }] : [])],
    },
    data: { accountType: type, accountVerifiedAt: type === AccountType.TRADER ? new Date() : null },
  });
  return db.user.findUniqueOrThrow({ where: { id: user.id }, select: sessionUserSelect });
}

/** For API routes: 401 when signed out, 403 unless a verified account of this type. */
export async function requireAccountType(type: AccountType): Promise<SessionUser> {
  const user = await requireUser();
  if (user.accountType !== type) {
    throw forbidden(type === AccountType.TRADER ? "Only trader accounts can trade" : "VC account required");
  }
  if (!user.accountVerifiedAt) throw forbidden("Your account hasn't been verified yet");
  return user;
}

/** Where someone lands after sign-in. Unchosen or unverified accounts finish at /onboarding. */
export function homePathFor(user: Pick<SessionUser, "accountType" | "accountVerifiedAt">): string {
  if (!user.accountType || !user.accountVerifiedAt) return "/onboarding";
  return user.accountType === AccountType.VC ? "/vc" : "/profile";
}

/** For API routes and server actions: throws 401/403 unless a platform admin. */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) throw forbidden("Administrator access required");
  return user;
}

/** For pages: sends signed-out visitors to sign in, then back to `returnTo`. */
export async function requireUserPage(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const { redirectToSignIn } = await auth();
  return redirectToSignIn({ returnBackUrl: returnTo });
}

/**
 * For admin pages: sends signed-out visitors to sign in and shows a 404 to
 * signed-in non-admins, so the admin area's existence is not advertised.
 */
export async function requireAdminPage(returnTo = "/admin"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const { redirectToSignIn } = await auth();
    return redirectToSignIn({ returnBackUrl: returnTo });
  }
  if (!isPlatformAdmin(user)) notFoundPage();
  return user;
}
