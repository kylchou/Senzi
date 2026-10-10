import type { Market, Resolution } from "@/generated/prisma/client";
import { MarketStatus, ResolutionOutcome, SettlementStatus, SourceLicense, SourceType, VoidReason } from "@/generated/prisma/enums";
import type { listResolutionProposals } from "@/lib/resolutions";
import type { SessionUser } from "@/lib/types";
import {
  approveProposalAction,
  proposeCorrectionAction,
  proposeResolutionAction,
  rejectProposalAction,
  retrySettlementAction,
} from "../../actions";
import { ActionForm } from "../../_components/action-form";
import { Badge, Field, formatUtc, Section, Select, TextArea } from "../../_components/ui";

type Proposal = Awaited<ReturnType<typeof listResolutionProposals>>[number];

const label = (value: string) => value.replace(/_/g, " ").toLowerCase();
const options = (values: string[]) => values.map((v) => ({ value: v, label: label(v) }));

/** Outcome, void reason, summary, and evidence fields shared by proposals and corrections. */
function ProposalFields({ withCorrectionReason = false }: { withCorrectionReason?: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Outcome"
          name="outcome"
          options={Object.values(ResolutionOutcome).map((o) => ({
            value: o,
            label: o === ResolutionOutcome.VOID ? "VOID (refund all stakes)" : o,
          }))}
        />
        <Select
          label="If VOID, why"
          name="voidReason"
          options={[{ value: "", label: "—" }, ...options(Object.values(VoidReason))]}
        />
      </div>
      <TextArea label="Evidence summary" name="evidenceSummary" required hint="How the evidence meets (or fails) the criteria." />
      <TextArea label="Evidence" name="evidence" required rows={3} hint="One per line: Title | https://link" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Source type" name="sourceType" options={options(Object.values(SourceType))} defaultValue={SourceType.COMPANY_ANNOUNCEMENT} />
        <Select label="What we may do with it" name="license" options={options(Object.values(SourceLicense))} defaultValue={SourceLicense.LINK_ONLY} />
      </div>
      {withCorrectionReason && <TextArea label="What was wrong" name="correctionReason" required rows={2} />}
    </>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <p>
        <Badge>{proposal.status}</Badge>{" "}
        {proposal.correctsId ? "Correction to " : ""}
        <strong>{proposal.outcome}</strong>
        {proposal.voidReason ? ` (${label(proposal.voidReason)})` : ""} · proposed by {proposal.proposedBy.displayName} on{" "}
        {formatUtc(proposal.proposedAt)}
        {proposal.reviewedBy ? ` · reviewed by ${proposal.reviewedBy.displayName}` : ""}
      </p>
      {proposal.correctionReason && <p>Reason for correction: {proposal.correctionReason}</p>}
      <p className="whitespace-pre-wrap">{proposal.evidenceSummary}</p>
      <ul className="list-disc pl-5">
        {proposal.evidence.map((e) => (
          <li key={e.id}>
            <a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.title}</a>{" "}
            <span className="text-xs text-zinc-500">
              {label(e.sourceType)} · {label(e.license)} · retrieved {formatUtc(e.retrievedAt)}
            </span>
          </li>
        ))}
      </ul>
      {proposal.reviewNote && <p className="text-zinc-500">Review note: {proposal.reviewNote}</p>}
    </div>
  );
}

export function ResolutionPanel({
  market,
  resolution,
  proposals,
  viewer,
}: {
  market: Pick<Market, "id" | "status" | "yesCriteria" | "noCriteria">;
  resolution: Resolution | null;
  proposals: Proposal[];
  viewer: SessionUser;
}) {
  const pending = proposals.find((p) => p.status === "PROPOSED");
  const history = proposals.filter((p) => p.status !== "PROPOSED");
  const resolvable = market.status === MarketStatus.OPEN || market.status === MarketStatus.CLOSED;
  const criteria = (
    <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      <p>YES if: <span className="whitespace-pre-wrap">{market.yesCriteria}</span></p>
      <p>NO if: <span className="whitespace-pre-wrap">{market.noCriteria}</span></p>
    </div>
  );

  return (
    <>
      {resolution && (
        <Section title="Resolution">
          <div className="space-y-2 text-sm">
            <p>
              Outcome <strong>{resolution.outcome}</strong>
              {resolution.voidReason ? ` (${label(resolution.voidReason)})` : ""} · approved {formatUtc(resolution.approvedAt ?? resolution.resolvedAt)}
              {resolution.correctionCount > 0 ? ` · corrected ${resolution.correctionCount}×` : ""} · settlement{" "}
              <Badge>{resolution.settlementStatus}</Badge>
            </p>
            {resolution.settlementError && <p className="text-rose-700">Settlement error: {resolution.settlementError}</p>}
            {resolution.settlementStatus !== SettlementStatus.COMPLETED && (
              <ActionForm action={retrySettlementAction.bind(null, resolution.id)} submitLabel="Run settlement now" />
            )}
          </div>
        </Section>
      )}

      {pending && (
        <Section title="Waiting for approval">
          <ProposalCard proposal={pending} />
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <ActionForm action={approveProposalAction.bind(null, pending.id)} submitLabel="Approve">
              {pending.proposedById === viewer.id && (
                <p className="text-sm text-amber-700">You proposed this, so a different admin has to approve it.</p>
              )}
              <Field label="Note (optional)" name="note" />
            </ActionForm>
            <ActionForm
              action={rejectProposalAction.bind(null, pending.id)}
              submitLabel={pending.proposedById === viewer.id ? "Withdraw" : "Reject"}
              tone="danger"
            >
              <Field label="Reason" name="reason" required />
            </ActionForm>
          </div>
        </Section>
      )}

      {resolvable && !pending && !resolution && (
        <Section title="Propose resolution">
          <ActionForm action={proposeResolutionAction.bind(null, market.id)} submitLabel="Submit for approval" tone="danger">
            {criteria}
            <ProposalFields />
            <p className="text-xs text-zinc-500">
              Forecasting closes while this is reviewed. Nothing is final until a second admin approves it.
            </p>
          </ActionForm>
        </Section>
      )}

      {resolution && !pending && (
        <Section title="Propose a correction">
          <ActionForm action={proposeCorrectionAction.bind(null, resolution.id)} submitLabel="Submit correction" tone="danger">
            {criteria}
            <ProposalFields withCorrectionReason />
            <p className="text-xs text-zinc-500">
              Needs a second admin. The outcome can only change before credits have settled; evidence can always be corrected.
            </p>
          </ActionForm>
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Resolution history">
          <div className="space-y-3">
            {history.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
