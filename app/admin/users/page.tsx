import { randomUUID } from "node:crypto";
import { AccountType, CreditTransactionType, PlatformRole } from "@/generated/prisma/enums";
import { searchUsersForAdmin } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { adjustCreditsAction, setAccountTypeAction, setPlatformRoleAction } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, PageHeader, Section, Select, Table } from "../_components/ui";

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requireAdminPage("/admin/users");
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 120) : undefined;
  const users = await searchUsersForAdmin(admin, { q: query });

  return (
    <>
      <PageHeader title="Users & credits" />
      <form className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by name, username, or email"
          className="w-full max-w-sm rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
        />
        <button className="rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700">Search</button>
      </form>

      <Section title="Users">
        <Table head={["Name", "Email", "Balance", "Role", "Account", ""]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2 pr-4">
                {u.displayName}
                {u.username && <span className="ml-1 text-zinc-500">@{u.username}</span>}
                <div className="font-mono text-xs text-zinc-400">{u.id}</div>
              </td>
              <td className="py-2 pr-4">{u.email}</td>
              <td className="py-2 pr-4 tabular-nums">{u.creditBalance.toLocaleString()}</td>
              <td className="py-2 pr-4">{u.platformRole}</td>
              <td className="py-2 pr-4">{u.accountType ?? "Not chosen"}</td>
              <td className="py-2 pr-4">
                {u.id !== admin.id && (
                  <ActionForm
                    action={setPlatformRoleAction.bind(null, u.id)}
                    submitLabel={u.platformRole === PlatformRole.ADMIN ? "Remove admin" : "Make admin"}
                  >
                    <input
                      type="hidden"
                      name="platformRole"
                      value={u.platformRole === PlatformRole.ADMIN ? PlatformRole.USER : PlatformRole.ADMIN}
                    />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Change account type">
        <ActionForm action={setAccountTypeAction} submitLabel="Change">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="User id" name="userId" required />
            <Select
              label="Account type"
              name="accountType"
              options={[
                { value: AccountType.TRADER, label: "Trader" },
                { value: AccountType.VC, label: "VC" },
              ]}
            />
          </div>
          <Field label="Reason" name="reason" required minLength={3} hint="Saved to the audit log. Remove someone from their VC orgs before making them a trader." />
        </ActionForm>
      </Section>

      <Section title="Adjust virtual credits">
        <ActionForm action={adjustCreditsAction} submitLabel="Apply">
          {/* New key per page render, so a double-click can't apply twice. */}
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="User id" name="userId" required />
            <Field label="Amount" name="amount" type="number" step={1} required hint="Negative to debit (adjustments only)" />
            <Select
              label="Type"
              name="type"
              options={[
                { value: CreditTransactionType.ADMIN_GRANT, label: "Grant" },
                { value: CreditTransactionType.ADMIN_ADJUSTMENT, label: "Correction" },
              ]}
            />
          </div>
          <Field label="Reason" name="memo" required hint="Saved to the ledger and audit log." />
        </ActionForm>
      </Section>
    </>
  );
}
