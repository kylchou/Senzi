import type { Prisma } from "@/generated/prisma/client";
import { db, type DbOrTx } from "@/lib/db";

export interface AuditEntry {
  actorId: string | null;
  organizationId?: string | null;
  /** Dotted verb: "<entity>.<verb>", e.g. "market.resolve". */
  action: string;
  entityType: string;
  entityId: string;
  data?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Appends an audit log row. Pass the transaction client when the audited
 * change happens inside a transaction so both commit (or roll back) together.
 * The AuditLog table rejects UPDATE/DELETE at the database level.
 */
export async function recordAudit(entry: AuditEntry, client: DbOrTx = db) {
  return client.auditLog.create({
    data: {
      actorId: entry.actorId,
      organizationId: entry.organizationId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data: entry.data,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/** Best-effort client IP from proxy headers, for audit entries. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

/**
 * Before/after values for the fields an update actually changed, for the
 * audit log: { closesAt: { from, to } }. Fields passed as undefined are skipped.
 */
export function diffChanges(
  before: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const normalize = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const from = normalize(before[key]);
    const to = normalize(value);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return changes;
}
