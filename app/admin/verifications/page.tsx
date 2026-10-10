import { VerificationStatus } from "@/generated/prisma/enums";
import { requireAdminPage } from "@/lib/auth";
import { emailMatchesWebsite, listVcVerifications } from "@/lib/verification";
import { reviewVerificationAction } from "../actions";
import { ActionForm } from "../_components/action-form";
import { formatUtc, PageHeader, Section, Select, TextArea } from "../_components/ui";

export default async function AdminVerificationsPage() {
  const admin = await requireAdminPage("/admin/verifications");
  const pending = await listVcVerifications(admin, VerificationStatus.PENDING);

  return (
    <>
      <PageHeader title="VC verifications" />
      <p className="mb-6 text-sm text-zinc-500">
        Check that the person works at the firm before approving: the website, a work email on the firm&apos;s domain, and their
        LinkedIn. Approving gives them VC access. You can&apos;t review your own request.
      </p>
      {pending.length === 0 && <p className="text-sm text-zinc-500">Nothing waiting.</p>}
      {pending.map((r) => {
        const domainMatch = emailMatchesWebsite(r.workEmail, r.firmWebsite);
        return (
          <Section key={r.id} title={`${r.firmName} · ${r.user.displayName}`}>
            <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-zinc-500">Account</dt>
              <dd>{r.user.email}</dd>
              <dt className="text-zinc-500">Role</dt>
              <dd>{r.jobTitle}</dd>
              <dt className="text-zinc-500">Firm website</dt>
              <dd>
                <a href={r.firmWebsite} target="_blank" rel="noopener noreferrer" className="underline">
                  {r.firmWebsite}
                </a>
              </dd>
              <dt className="text-zinc-500">Work email</dt>
              <dd>
                {r.workEmail}{" "}
                <span className={domainMatch ? "text-emerald-700" : "text-amber-700"}>
                  {domainMatch ? "(matches the firm's domain)" : "(not on the firm's domain)"}
                </span>
              </dd>
              {r.linkedinUrl && (
                <>
                  <dt className="text-zinc-500">LinkedIn</dt>
                  <dd>
                    <a href={r.linkedinUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      {r.linkedinUrl}
                    </a>
                  </dd>
                </>
              )}
              {r.note && (
                <>
                  <dt className="text-zinc-500">Note</dt>
                  <dd className="whitespace-pre-wrap">{r.note}</dd>
                </>
              )}
              <dt className="text-zinc-500">Sent</dt>
              <dd>{formatUtc(r.createdAt)}</dd>
            </dl>
            {r.userId === admin.id ? (
              <p className="text-sm text-zinc-500">This is your own request. Another admin has to review it.</p>
            ) : (
              <ActionForm action={reviewVerificationAction.bind(null, r.id)} submitLabel="Save decision">
                <Select
                  label="Decision"
                  name="decision"
                  options={[
                    { value: VerificationStatus.APPROVED, label: "Approve" },
                    { value: VerificationStatus.REJECTED, label: "Reject" },
                  ]}
                />
                <TextArea label="Note" name="note" rows={2} hint="Required when rejecting. The applicant sees it." />
              </ActionForm>
            )}
          </Section>
        );
      })}
    </>
  );
}
