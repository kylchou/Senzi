# Proposal for Ky: VC and trader account types

From Felix, Oct 10, 2026. Status: proposal. Nothing below has been applied, because it touches the schema, migrations, and auth, which Ky owns.

## What we want

Two distinct kinds of user, chosen at signup:

- **VC (sponsor):** opens questions, enters startup metrics (sponsor-provided), reads the VC dashboard at `/vc`.
- **Trader (retail):** trades on markets they are verified for, has a portfolio, and can request verification to unlock more markets.

This is separate from `PlatformRole` (USER/ADMIN). An admin can be either account type.

Rules:

1. The user picks a type on the sign-up page, before Clerk's form.
2. Users choose their type once and can't change it. Only an admin can change it later. This stops a sponsor from switching to trader and trading on their own question.
3. Anyone signed in without a type (older accounts, or OAuth sign-ups that skipped the picker) is sent to `/onboarding` to choose.
4. VC accounts cannot trade, on any market (decided by Felix, Oct 10). Only TRADER accounts can submit forecasts. VC accounts get 403 from `POST /api/forecasts`.

## 1. Schema (`prisma/schema.prisma`)

```prisma
/// Which side of the product a person signed up for. Declared once at signup.
/// NULL means signed in but not chosen yet (see /onboarding).
enum AccountType {
  VC // sponsors: open questions, enter startup metrics, read the VC dashboard
  TRADER // retail traders: trade on markets they are verified for
}

model User {
  // ...
  platformRole  PlatformRole @default(USER)
  accountType   AccountType?
  // ...
}
```

## 2. Migration (`prisma/migrations/<ts>_account_type/migration.sql`)

```sql
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('VC', 'TRADER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType";

-- Backfill: members of a VC organization (including pending invites) are VCs;
-- every other existing user is a trader.
UPDATE "User" u SET "accountType" = 'VC'
WHERE EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id");
UPDATE "User" SET "accountType" = 'TRADER' WHERE "accountType" IS NULL;
```

## 3. Shared types (`lib/types.ts`)

- Re-export `AccountType` from `@/generated/prisma/enums`.
- Add `accountType: AccountType | null` to `SessionUser`. `CurrentUserResponse` extends it, so `GET /api/users/me` returns it with no route change.

Every hand-written `SessionUser` select must add `accountType: true`:

- `lib/auth.ts` (`sessionUserSelect`)
- `lib/users.ts` (`updateProfile`)
- `tests/integration/helpers.ts` (`makeUser`): add an `accountType` option that defaults to `TRADER`
- `lib/model/cli/seed-real-markets.ts` (Felix's): simulated traders get `TRADER`

## 4. Auth (`lib/auth.ts`)

The sign-up page passes the choice to Clerk as `unsafeMetadata.accountType`. Clerk lets the client write that field, which is fine here because the user is declaring it about themselves. The server only accepts it while `accountType` is still NULL.

```ts
export interface AuthIdentity {
  // ...existing fields
  /** Self-declared at signup via Clerk unsafeMetadata. Null if missing or invalid. */
  accountType: AccountType | null;
}

export function parseAccountType(value: unknown): AccountType | null {
  return value === AccountType.VC || value === AccountType.TRADER ? value : null;
}
```

- `getAuthIdentity()`: `accountType: parseAccountType(clerkUser.unsafeMetadata?.accountType)`.
- `identityFromClerkUser()` (webhook): `accountType: parseAccountType(data.unsafe_metadata?.accountType)`.
- `provisionUser()`: on create, set `accountType: identity.accountType`. When claiming a pending invite, keep the invite's type and fill it from the identity only if it is NULL.
- New helpers:

```ts
/** Sets the account type once. A no-op if it's already set (returns the current row). */
export async function chooseAccountType(user: SessionUser, type: AccountType): Promise<SessionUser> {
  await db.user.updateMany({ where: { id: user.id, accountType: null }, data: { accountType: type } });
  return db.user.findUniqueOrThrow({ where: { id: user.id }, select: sessionUserSelect });
}

/** API routes: 401 when signed out, 403 for the wrong (or unchosen) account type. */
export async function requireAccountType(type: AccountType): Promise<SessionUser> {
  const user = await requireUser();
  if (user.accountType !== type) {
    throw forbidden(type === AccountType.TRADER ? "Only trader accounts can trade" : "VC account required");
  }
  return user;
}

/** Where each account type lands after sign-in. */
export function homePathFor(type: AccountType | null): string {
  if (type === AccountType.VC) return "/vc";
  if (type === AccountType.TRADER) return "/portfolio"; // "/markets" until /portfolio exists
  return "/onboarding";
}
```

## 5. Sign-up and onboarding pages

- `app/sign-up/[[...sign-up]]/page.tsx`: a client step with two cards ("I'm an investor" and "I'm a trader"), then `<SignUp unsafeMetadata={{ accountType }} forceRedirectUrl="/onboarding" />`.
- New `app/onboarding/page.tsx` (server):
  - Signed out: redirect to sign-in.
  - Type already set: redirect to `homePathFor(type)`.
  - Otherwise: show the same two cards, with a server action that calls `chooseAccountType` and then redirects.
- `.env`: point `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` and `..._SIGN_UP_FALLBACK_REDIRECT_URL` at `/onboarding`, so every sign-in passes through the router.

## 6. Other call sites

- `lib/organizations.ts`: when an org invite creates a pending user, set `accountType: VC`.
- `prisma/seed.ts`: org members (maya, theo, priya, and the demo email) get `VC`. Everyone else gets `TRADER`.
- `tests/integration/auth.test.ts`: add cases for (a) the type taken from the identity on create, (b) a pending invite keeping `VC`, and (c) `chooseAccountType` not overwriting a set type.

## 7. Felix's side, after this lands

- `app/api/forecasts/route.ts`: replace `requireUser()` with `requireAccountType(AccountType.TRADER)`.
- Add an integration test: a VC account gets 403, a trader gets 201.

## Questions for Ky

1. Is gating `/vc` on `accountType === VC` OK, or should org membership stay the only gate? (`lib/vc/server/context.ts` is Darsh's, so he'd need to agree too.)
2. Should admins get an "change account type" action in `/admin/users`?
