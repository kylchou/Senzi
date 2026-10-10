import { AccountType, NotificationType, VerificationStatus } from "@/generated/prisma/enums";
import { assertAdmin } from "@/lib/admin-guard";
import { conflict, forbidden, invalidState, notFound } from "@/lib/api-response";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { RequestContext, SessionUser } from "@/lib/types";
import type { ReviewVerificationInput, VcVerificationInput } from "@/lib/validation";

/**
 * Account verification.
 *
 * Traders are verified by the email Clerk confirms at signup. VCs are verified
 * when a platform admin approves their firm details, or when a firm that is
 * already on Senzi adds them. Until then a VC account has no VC powers.
 */

export function isVerified(user: Pick<SessionUser, "accountType" | "accountVerifiedAt">): boolean {
  return user.accountType !== null && user.accountVerifiedAt !== null;
}

/** True when the work email is on the firm's own domain. A hint for reviewers, not proof. */
export function emailMatchesWebsite(email: string, website: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  let host: string;
  try {
    host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return !!domain && (domain === host || domain.endsWith(`.${host}`));
}

/** The user's most recent request, if any. */
export function latestVcVerification(userId: string) {
  return db.vcVerificationRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function submitVcVerification(user: SessionUser, input: VcVerificationInput, ctx: RequestContext = {}) {
  return db.$transaction(async (tx) => {
    // Lock the user so two submissions can't both pass the pending check.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { accountType: true, accountVerifiedAt: true } });
    if (current.accountType !== AccountType.VC) throw invalidState("Only VC accounts need firm verification");
    if (current.accountVerifiedAt) throw invalidState("Your account is already verified");
    const pending = await tx.vcVerificationRequest.count({ where: { userId: user.id, status: VerificationStatus.PENDING } });
    if (pending) throw conflict("Your details are already being reviewed");

    const request = await tx.vcVerificationRequest.create({ data: { userId: user.id, ...input } });
    await recordAudit(
      { actorId: user.id, action: "verification.submit", entityType: "VcVerificationRequest", entityId: request.id, ipAddress: ctx.ip },
      tx,
    );
    return request;
  });
}

export async function reviewVcVerification(
  admin: SessionUser,
  requestId: string,
  input: ReviewVerificationInput,
  ctx: RequestContext = {},
) {
  assertAdmin(admin);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "VcVerificationRequest" WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.vcVerificationRequest.findUnique({ where: { id: requestId } });
    if (!request) throw notFound("Verification request");
    if (request.userId === admin.id) throw forbidden("You can't review your own verification");
    if (request.status !== VerificationStatus.PENDING) throw invalidState("This request has already been reviewed");

    const now = new Date();
    const reviewed = await tx.vcVerificationRequest.update({
      where: { id: requestId },
      data: { status: input.decision, reviewedById: admin.id, reviewedAt: now, reviewNote: input.note ?? null },
    });
    const approved = input.decision === VerificationStatus.APPROVED;
    if (approved) {
      await tx.user.update({ where: { id: request.userId }, data: { accountVerifiedAt: now } });
    }
    await tx.notification.create({
      data: {
        userId: request.userId,
        type: NotificationType.SYSTEM,
        title: approved ? "Your VC account is verified" : "We couldn't verify your VC account",
        body: approved ? null : input.note,
        link: "/onboarding",
        data: { verificationRequestId: requestId },
      },
    });
    await recordAudit(
      {
        actorId: admin.id,
        action: "verification.review",
        entityType: "VcVerificationRequest",
        entityId: requestId,
        data: { userId: request.userId, from: request.status, to: input.decision, note: input.note ?? null },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return reviewed;
  });
}

export async function listVcVerifications(admin: SessionUser, status: VerificationStatus = VerificationStatus.PENDING) {
  assertAdmin(admin);
  return db.vcVerificationRequest.findMany({
    where: { status },
    orderBy: { createdAt: status === VerificationStatus.PENDING ? "asc" : "desc" },
    take: 100,
    include: { user: { select: { id: true, displayName: true, email: true } } },
  });
}

/**
 * Lets an unverified VC switch to a trader account. Not allowed once they're
 * in a firm, since a sponsor could then trade on their own questions.
 */
export async function switchToTrader(user: SessionUser, ctx: RequestContext = {}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { accountType: true, accountVerifiedAt: true, _count: { select: { memberships: true } } },
    });
    if (current.accountType !== AccountType.VC || current.accountVerifiedAt) {
      throw invalidState("Only unverified VC accounts can switch; ask an admin");
    }
    if (current._count.memberships > 0) throw invalidState("Leave your VC organizations first");

    await tx.vcVerificationRequest.updateMany({
      where: { userId: user.id, status: VerificationStatus.PENDING },
      data: { status: VerificationStatus.REJECTED, reviewedAt: new Date(), reviewNote: "Withdrawn: switched to a trader account" },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { accountType: AccountType.TRADER, accountVerifiedAt: new Date() },
    });
    await recordAudit(
      { actorId: user.id, action: "user.accountType", entityType: "User", entityId: user.id, data: { from: "VC", to: "TRADER", reason: "Switched before VC verification" }, ipAddress: ctx.ip },
      tx,
    );
  });
}
