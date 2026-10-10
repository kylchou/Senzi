# VC Intelligence: open requests

Things VC Intelligence needs from other parts of the app. Each item says who it's for, why it's needed, and what already works without it.

## Kyler: schema for alert workflows

Alerts already work without these: the firm feed, personal inbox delivery, read state, the dashboard panel and filters. These additions turn alerts into a workflow a firm can configure and work through. The Prisma below passes `prisma validate` when merged into `dev`'s schema.

### 1. Alert rules (per firm, optionally per watchlist)

Lets a firm choose which alert types it gets and set its own thresholds. Today the thresholds are fixed constants in `lib/vc/constants.ts`: a 10-point move in 24 hours, deadlines within 3 days.

```prisma
model VcAlertRule {
  id                String      @id @default(cuid())
  organizationId    String
  /// null = firm-wide default; set = override for one watchlist.
  watchlistId       String?     @unique
  enabledTypes      VcAlertType[]
  /// Absolute move in the YES allocation share (0–1) over 24 hours.
  movementThreshold Float       @default(0.1)
  deadlineLeadHours Int         @default(72)
  /// Also copy alerts into members' personal inboxes.
  notifyInbox       Boolean     @default(true)
  updatedById       String?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  watchlist    Watchlist?   @relation(fields: [watchlistId], references: [id], onDelete: Cascade)
  updatedBy    User?        @relation("AlertRuleUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)

  @@index([organizationId])
}
```

Back-relations: `Organization.alertRules VcAlertRule[]`, `Watchlist.alertRule VcAlertRule?`, `User.updatedAlertRules VcAlertRule[] @relation("AlertRuleUpdatedBy")`.

One firm-wide default per organization is enforced in code: a partial unique index on `(organizationId) WHERE watchlistId IS NULL` would need raw SQL in the migration, so it's your call.

### 2. Triage fields on `VcAlert`

Lets a firm work through alerts: New → Acknowledged → Resolved, assign one to an analyst, and record what was done. Read receipts stay per person; triage state is shared by the firm.

```prisma
enum VcAlertStatus {
  NEW
  ACKNOWLEDGED
  RESOLVED
}

// Add to model VcAlert:
  status         VcAlertStatus @default(NEW)
  assigneeId     String?
  resolvedById   String?
  resolvedAt     DateTime?
  resolutionNote String?

  assignee   User? @relation("VcAlertAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  resolvedBy User? @relation("VcAlertResolvedBy", fields: [resolvedById], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
```

Back-relations on `User`: `assignedAlerts VcAlert[] @relation("VcAlertAssignee")`, `resolvedAlerts VcAlert[] @relation("VcAlertResolvedBy")`. Every triage change will be written with `recordAudit`.

### 3. A notification type for VC alerts

Personal inbox copies currently reuse `MARKET_CLOSING` (deadlines), `MARKET_RESOLVED` (resolutions) and `SYSTEM` (movements and status changes). Please add `VC_ALERT` to `NotificationType`, so the bell can group and filter them. The VC alert id is already in `Notification.data.vcAlertId`.

## Felix: make `lib/model` and `lib/forecasting` bundleable by Next.js

Relative imports in both folders end in `.js` (for example `from './store.js'`). Vitest and `tsx` resolve those to the `.ts` files, but Next.js 16's bundler (Turbopack) doesn't, so `next build` fails as soon as an app route imports either module. Nothing imported them until now.

- **Fix:** drop the `.js` suffix on relative imports (`'./store.js'` → `'./store'`). I checked in a scratch copy: after that change in `lib/model`, `next build` passes with the comparison page reading real indicators.
- **What waits on it:** public indicators on the startup comparison page. `lib/vc/server/indicators-adapter.ts` is written and tested against the real model data. Until the fix lands, the app uses a placeholder that shows "temporarily unavailable". Switching over is one line in `lib/vc/server/container.ts`.
- **`lib/forecasting`:** the same applies before any app code can call the engine. The comparison only uses `stats.ts`, which has no relative imports, so it already builds.

## Kyler: AI research assistant dependency

See [`AI_RESEARCH_ASSISTANT.md`](./AI_RESEARCH_ASSISTANT.md). Before building, it needs approval to add `@anthropic-ai/sdk` to `package.json`, an `ANTHROPIC_API_KEY` in the deployment environment, and a decision on data retention with Anthropic.
