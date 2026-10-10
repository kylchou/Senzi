import { VerificationStatus } from "@/generated/prisma/enums";
import { requireAdminPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestTime } from "@/lib/market-view/format";
import { listAccessCodes, listPendingScreenshots } from "@/lib/product-verification";
import { createAccessCodeAction, reviewProductVerificationAction, revokeAccessCodeAction } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, formatUtc, PageHeader, Section, Select, Table, TextArea } from "../_components/ui";

export default async function AdminProductUsersPage() {
  const admin = await requireAdminPage("/admin/product-users");
  const [codes, screenshots, startups] = await Promise.all([
    listAccessCodes(admin),
    listPendingScreenshots(admin),
    db.startup.findMany({ where: { isPublished: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const now = requestTime();

  return (
    <>
      <PageHeader title="Product users" />
      <p className="mb-6 text-sm text-zinc-500">
        People prove they use a startup&apos;s product to unlock its verified-users-only markets. An access code verifies them
        instantly; a screenshot waits for review here. For a demo, make a code like STRIPE-DEMO and enter it at /verify/stripe.
      </p>

      <Section title={`Screenshots to review (${screenshots.length})`}>
        {screenshots.length === 0 && <p className="text-sm text-zinc-500">Nothing waiting.</p>}
        <div className="space-y-6">
          {screenshots.map((s) => (
            <div key={s.id} className="grid gap-4 border-b border-zinc-200 pb-6 last:border-0 dark:border-zinc-800 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <a href={`/api/admin/product-verifications/${s.id}/screenshot`} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, uncached image route */}
                <img
                  src={`/api/admin/product-verifications/${s.id}/screenshot`}
                  alt={`Screenshot from ${s.user.displayName} for ${s.startup.name}`}
                  className="max-h-96 w-full rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
                />
              </a>
              <div className="space-y-3 text-sm">
                <p>
                  <strong>{s.user.displayName}</strong> ({s.user.email}) says they use <strong>{s.startup.name}</strong>.
                </p>
                {s.note && <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{s.note}</p>}
                <p className="text-zinc-500">Sent {formatUtc(s.createdAt)}</p>
                {s.userId === admin.id ? (
                  <p className="text-zinc-500">This is your own request. Another admin has to review it.</p>
                ) : (
                  <ActionForm action={reviewProductVerificationAction.bind(null, s.id)} submitLabel="Save decision">
                    <Select
                      label="Decision"
                      name="decision"
                      options={[
                        { value: VerificationStatus.APPROVED, label: "Approve" },
                        { value: VerificationStatus.REJECTED, label: "Reject" },
                      ]}
                    />
                    <TextArea label="Note" name="note" rows={2} hint="Required when rejecting. They'll see it." />
                  </ActionForm>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Create an access code">
        <ActionForm action={createAccessCodeAction} submitLabel="Create code">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Startup" name="startupId" options={startups.map((s) => ({ value: s.id, label: s.name }))} />
            <Field label="Code" name="code" placeholder="Leave blank to generate one" hint="Custom codes are handy for demos, e.g. STRIPE-DEMO." />
            <Field label="Label" name="label" placeholder="e.g. Stripe beta customers" />
            <Field label="Max uses" name="maxUses" type="number" min={1} hint="Blank means unlimited." />
            <Field label="Expires in (days)" name="expiresInDays" type="number" min={1} max={365} hint="Blank means it never expires." />
          </div>
        </ActionForm>
      </Section>

      <Section title="Access codes">
        <Table head={["Startup", "Code", "Label", "Uses", "Status", ""]}>
          {codes.map((c) => {
            const expired = c.expiresAt !== null && c.expiresAt.getTime() <= now;
            const usedUp = c.maxUses !== null && c.useCount >= c.maxUses;
            const status = c.revokedAt ? "Revoked" : expired ? "Expired" : usedUp ? "Used up" : "Active";
            return (
              <tr key={c.id}>
                <td className="py-2 pr-4">{c.startup.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">…{c.hint}</td>
                <td className="py-2 pr-4">{c.label ?? "—"}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {c.useCount}
                  {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                </td>
                <td className="py-2 pr-4">
                  {status}
                  {c.expiresAt && !c.revokedAt && <span className="ml-1 text-xs text-zinc-500">({formatUtc(c.expiresAt)})</span>}
                </td>
                <td className="py-2 pr-4">
                  {status === "Active" && (
                    <ActionForm action={revokeAccessCodeAction.bind(null, c.id)} submitLabel="Revoke" tone="danger" />
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        {codes.length === 0 && <p className="mt-2 text-sm text-zinc-500">No codes yet.</p>}
      </Section>
    </>
  );
}
