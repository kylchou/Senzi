import { ProductVerificationMethod, VerificationStatus } from "@/generated/prisma/enums";
import { generateCode, hashCode, normalizeCode, screenshotType } from "@/lib/product-proof";
import { assertAdmin } from "@/lib/admin-guard";
import { conflict, forbidden, invalidState, notFound } from "@/lib/api-response";
import { recordAudit } from "@/lib/audit";
import { db, type TxClient } from "@/lib/db";
import { selfApprovalAllowed } from "@/lib/resolutions";
import type { RequestContext, SessionUser } from "@/lib/types";
import type { CreateAccessCodeInput, ReviewVerificationInput } from "@/lib/validation";

/**
 * Verified product users: proof that someone actually uses a startup's
 * product. An approved verification unlocks that startup's
 * verified-users-only markets, and their trades count toward the Verified
 * Users line (lib/forecasting, TraderDirectory).
 *
 * Two ways in:
 * - Access code: the startup hands its users a code (for now a Senzi admin
 *   makes them at /admin/product-users). Instant, and the easy one to demo.
 * - Screenshot: a picture of their account, approved by an admin.
 */

export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;

export { generateCode, hashCode, normalizeCode, screenshotType };

export async function isVerifiedUserOf(userId: string, startupId: string, client: TxClient | typeof db = db): Promise<boolean> {
  const count = await client.productUserVerification.count({
    where: { userId, startupId, status: VerificationStatus.APPROVED },
  });
  return count > 0;
}

/** Same check by startup slug, for pages that only have the slug. */
export async function isVerifiedUserOfSlug(userId: string, startupSlug: string): Promise<boolean> {
  const count = await db.productUserVerification.count({
    where: { userId, startup: { slug: startupSlug }, status: VerificationStatus.APPROVED },
  });
  return count > 0;
}

/** What the verify page shows for one startup. */
export async function productVerificationStatus(userId: string, startupId: string) {
  const rows = await db.productUserVerification.findMany({
    where: { userId, startupId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, method: true, status: true, reviewNote: true, createdAt: true },
  });
  return {
    verified: rows.find((r) => r.status === VerificationStatus.APPROVED) ?? null,
    pending: rows.find((r) => r.status === VerificationStatus.PENDING) ?? null,
    lastRejected: rows[0]?.status === VerificationStatus.REJECTED ? rows[0] : null,
  };
}

/** Startups this user is a verified user of, for their profile. */
export async function listVerifiedStartups(userId: string) {
  const rows = await db.productUserVerification.findMany({
    where: { userId, status: VerificationStatus.APPROVED },
    orderBy: { createdAt: "asc" },
    distinct: ["startupId"],
    select: { startup: { select: { slug: true, name: true } } },
  });
  return rows.map((r) => r.startup);
}

// --- Access codes ----------------------------------------------------------------

export async function createAccessCode(admin: SessionUser, input: CreateAccessCodeInput, ctx: RequestContext = {}) {
  assertAdmin(admin);
  const startup = await db.startup.findUnique({ where: { id: input.startupId }, select: { id: true, slug: true } });
  if (!startup) throw notFound("Startup");
  const code = input.code ?? generateCode(startup.slug);
  if (normalizeCode(code).length < 6) throw invalidState("Codes need at least 6 letters or numbers");

  return db.$transaction(async (tx) => {
    const codeHash = hashCode(code);
    if (await tx.productAccessCode.findUnique({ where: { codeHash }, select: { id: true } })) {
      throw conflict("That code is already in use. Pick another.");
    }
    const row = await tx.productAccessCode.create({
      data: {
        startupId: startup.id,
        codeHash,
        hint: normalizeCode(code).slice(-4),
        label: input.label ?? null,
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
        createdById: admin.id,
      },
    });
    await recordAudit(
      {
        actorId: admin.id,
        action: "productAccessCode.create",
        entityType: "ProductAccessCode",
        entityId: row.id,
        data: { startupId: startup.id, label: row.label, maxUses: row.maxUses, expiresAt: row.expiresAt },
        ipAddress: ctx.ip,
      },
      tx,
    );
    // The only time the code itself is available.
    return { id: row.id, code };
  });
}

export async function revokeAccessCode(admin: SessionUser, codeId: string, ctx: RequestContext = {}) {
  assertAdmin(admin);
  return db.$transaction(async (tx) => {
    const { count } = await tx.productAccessCode.updateMany({ where: { id: codeId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw notFound("Active access code");
    await recordAudit({ actorId: admin.id, action: "productAccessCode.revoke", entityType: "ProductAccessCode", entityId: codeId, ipAddress: ctx.ip }, tx);
  });
}

export async function listAccessCodes(admin: SessionUser) {
  assertAdmin(admin);
  return db.productAccessCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      hint: true,
      label: true,
      maxUses: true,
      useCount: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      startup: { select: { name: true, slug: true } },
    },
  });
}

/**
 * Verifies the user instantly if the code belongs to this startup and is still
 * usable. Already-verified users keep their verification and use up nothing.
 */
export async function redeemAccessCode(user: SessionUser, startupId: string, rawCode: string, ctx: RequestContext = {}) {
  return db.$transaction(async (tx) => {
    // One redemption per user at a time, so a double-click can't use two slots.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const startup = await tx.startup.findUnique({ where: { id: startupId }, select: { id: true, name: true } });
    if (!startup) throw notFound("Startup");

    const existing = await tx.productUserVerification.findFirst({
      where: { userId: user.id, startupId, status: VerificationStatus.APPROVED },
    });
    if (existing) return existing;

    const code = await tx.productAccessCode.findUnique({ where: { codeHash: hashCode(rawCode) } });
    // Same message for every failure, so codes can't be probed.
    const invalid = () => invalidState(`That code isn't valid for ${startup.name}`);
    if (!code || code.startupId !== startupId) throw invalid();
    const used = await tx.$executeRaw`
      UPDATE "ProductAccessCode" SET "useCount" = "useCount" + 1
      WHERE id = ${code.id}
        AND "revokedAt" IS NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
        AND ("maxUses" IS NULL OR "useCount" < "maxUses")`;
    if (used === 0) throw invalid();

    const now = new Date();
    // A screenshot still waiting for review isn't needed anymore.
    await tx.productUserVerification.updateMany({
      where: { userId: user.id, startupId, status: VerificationStatus.PENDING },
      data: { status: VerificationStatus.REJECTED, reviewedAt: now, reviewNote: "Verified with an access code instead" },
    });
    const verification = await tx.productUserVerification.create({
      data: {
        userId: user.id,
        startupId,
        method: ProductVerificationMethod.ACCESS_CODE,
        status: VerificationStatus.APPROVED,
        accessCodeId: code.id,
        reviewedAt: now,
      },
    });
    await recordAudit(
      {
        actorId: user.id,
        action: "productVerification.code",
        entityType: "ProductUserVerification",
        entityId: verification.id,
        data: { startupId, accessCodeId: code.id },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return verification;
  });
}

// --- Screenshots -----------------------------------------------------------------

export async function submitScreenshot(
  user: SessionUser,
  startupId: string,
  input: { bytes: Uint8Array; note?: string | null },
  ctx: RequestContext = {},
) {
  if (input.bytes.length === 0) throw invalidState("Choose a screenshot to upload");
  if (input.bytes.length > SCREENSHOT_MAX_BYTES) throw invalidState("Screenshots can be up to 3 MB");
  const type = screenshotType(input.bytes);
  if (!type) throw invalidState("Upload a PNG, JPEG, or WebP image");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const startup = await tx.startup.findUnique({ where: { id: startupId }, select: { id: true } });
    if (!startup) throw notFound("Startup");
    const open = await tx.productUserVerification.findFirst({
      where: { userId: user.id, startupId, status: { in: [VerificationStatus.PENDING, VerificationStatus.APPROVED] } },
      select: { status: true },
    });
    if (open?.status === VerificationStatus.APPROVED) throw invalidState("You're already verified");
    if (open) throw conflict("Your screenshot is already being reviewed");

    const verification = await tx.productUserVerification.create({
      data: {
        userId: user.id,
        startupId,
        method: ProductVerificationMethod.SCREENSHOT,
        screenshot: Buffer.from(input.bytes),
        screenshotType: type,
        note: input.note ?? null,
      },
      select: { id: true, status: true, createdAt: true },
    });
    await recordAudit(
      { actorId: user.id, action: "productVerification.submit", entityType: "ProductUserVerification", entityId: verification.id, data: { startupId }, ipAddress: ctx.ip },
      tx,
    );
    return verification;
  });
}

export async function reviewProductVerification(
  admin: SessionUser,
  verificationId: string,
  input: ReviewVerificationInput,
  ctx: RequestContext = {},
) {
  assertAdmin(admin);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductUserVerification" WHERE id = ${verificationId} FOR UPDATE`;
    const row = await tx.productUserVerification.findUnique({
      where: { id: verificationId },
      select: { userId: true, startupId: true, status: true, startup: { select: { name: true, slug: true } } },
    });
    if (!row) throw notFound("Verification");
    if (row.userId === admin.id && !selfApprovalAllowed()) throw forbidden("You can't review your own verification");
    if (row.status !== VerificationStatus.PENDING) throw invalidState("This verification has already been reviewed");

    const approved = input.decision === VerificationStatus.APPROVED;
    const reviewed = await tx.productUserVerification.update({
      where: { id: verificationId },
      data: { status: input.decision, reviewedById: admin.id, reviewedAt: new Date(), reviewNote: input.note ?? null },
      select: { id: true, status: true },
    });
    await tx.notification.create({
      data: {
        userId: row.userId,
        type: "SYSTEM",
        title: approved ? `You're a verified ${row.startup.name} user` : `We couldn't verify you as a ${row.startup.name} user`,
        body: approved ? "Markets for verified users are now unlocked." : input.note,
        link: `/verify/${row.startup.slug}`,
      },
    });
    await recordAudit(
      {
        actorId: admin.id,
        action: "productVerification.review",
        entityType: "ProductUserVerification",
        entityId: verificationId,
        data: { userId: row.userId, startupId: row.startupId, from: row.status, to: input.decision, note: input.note ?? null },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return reviewed;
  });
}

/** Screenshots waiting for review. The image itself is served separately. */
export async function listPendingScreenshots(admin: SessionUser) {
  assertAdmin(admin);
  return db.productUserVerification.findMany({
    where: { status: VerificationStatus.PENDING, method: ProductVerificationMethod.SCREENSHOT },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      note: true,
      createdAt: true,
      user: { select: { displayName: true, email: true } },
      startup: { select: { name: true, slug: true } },
    },
  });
}

export async function getScreenshot(admin: SessionUser, verificationId: string) {
  assertAdmin(admin);
  const row = await db.productUserVerification.findUnique({
    where: { id: verificationId },
    select: { screenshot: true, screenshotType: true },
  });
  if (!row?.screenshot || !row.screenshotType) throw notFound("Screenshot");
  return { bytes: row.screenshot, type: row.screenshotType };
}
