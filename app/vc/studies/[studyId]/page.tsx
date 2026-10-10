import Link from "next/link";
import { EstimateSummary } from "@/components/vc/EstimateSummary";
import { FollowButton } from "@/components/vc/FollowButton";
import { MarketGaps } from "@/components/vc/MarketGaps";
import { CompanySignalsPanel, ModelCalculationPanel } from "@/components/vc/ModelEvidencePanel";
import { NotesPanel } from "@/components/vc/NotesPanel";
import { ParticipantsEditor } from "@/components/vc/ParticipantsEditor";
import { Section } from "@/components/vc/Section";
import { StatusBadge, VisibilityBadge } from "@/components/vc/StatusBadge";
import { TransitionControls } from "@/components/vc/TransitionControls";
import { ThreeLineChart } from "@/components/vc/ThreeLineChart";
import { describeFreshness, describeUncertainty, resolveBaseline } from "@/lib/vc/estimates";
import { STATUS_LABELS, VISIBILITY_LABELS, formatDate, formatDateTime } from "@/lib/vc/format";
import { studyModelEvidence } from "@/lib/vc/server/company-model";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { orNotFound, requirePageContext } from "@/lib/vc/server/page";
import type { StudyVisibility } from "@/lib/vc/types";

/** What the invite list means for each visibility; mirrors getStudyPermissions and visibleMarketsWhere. */
const PARTICIPANT_SCOPE: Record<StudyVisibility, string> = {
  RESTRICTED: "Only these people, plus firm owners/admins and the author, can view and forecast.",
  ORGANIZATION:
    "Everyone in your firm already has access, and people outside it don't. Invitations only change access on restricted studies.",
  PUBLIC: "Anyone can view and forecast once the study opens. Invitations only change access on restricted studies.",
};

export default async function StudyPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const ctx = await requirePageContext(`/vc/studies/${studyId}`);
  const services = getVcServices();
  const detail = await orNotFound(services.studies.get(ctx, studyId));
  const { study, permissions, estimate, history, events, participants, startup, evidence, openingLine } = detail;
  const preOpen = study.status === "DRAFT" || study.status === "SUBMITTED" || study.status === "APPROVED";
  const full = permissions.viewLevel === "full";
  const now = new Date();

  const baseline = resolveBaseline(study, estimate);
  const freshness = describeFreshness(estimate, study.status, now);
  const uncertainty = describeUncertainty(estimate, history, freshness);

  const [notes, following, modelEvidence] = await Promise.all([
    permissions.canViewPrivate ? services.studies.listNotes(ctx, studyId) : Promise.resolve([]),
    services.watchlists.isFollowing(ctx, { type: "STUDY", studyId }),
    studyModelEvidence(ctx, study.startupId, study.marketId),
  ]);
  const authorIds = [...new Set([...notes.map((n) => n.authorId), ...events.map((e) => e.actorId).filter(Boolean)])];
  const authors = Object.fromEntries(
    (full && authorIds.length ? await getVcDeps().platform.getUsers(authorIds as string[]) : []).map((u) => [
      u.id,
      u.name ?? u.email ?? "Team member",
    ]),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <StatusBadge status={study.status} />
          <VisibilityBadge visibility={study.visibility} />
          {startup && <Link className="underline" href={`/vc/companies/${startup.slug}`}>{startup.name}</Link>}
          <span>· Deadline {formatDateTime(study.deadline)}</span>
          {!full && <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">Limited view</span>}
        </div>
        <h1 className="text-2xl font-semibold leading-tight">{study.question}</h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {permissions.canEdit && (
            <Link
              href={`/vc/studies/${study.id}/edit`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Edit draft
            </Link>
          )}
          {permissions.canGenerateReports && (
            <Link
              href={`/vc/studies/${study.id}/report`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Report
            </Link>
          )}
          {following !== null && <FollowButton target={{ type: "STUDY", studyId: study.id }} following={following} />}
        </div>
      </header>

      {(study.rejectionReason || study.cancellationReason) && (
        <div role="status" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {study.rejectionReason && <p><strong>Rejected:</strong> {study.rejectionReason}</p>}
          {study.cancellationReason && <p><strong>Cancelled:</strong> {study.cancellationReason}</p>}
        </div>
      )}

      {permissions.allowedActions.length > 0 && (
        <Section id="lifecycle" title="Lifecycle" description={`Current status: ${STATUS_LABELS[study.status]}`}>
          <TransitionControls studyId={study.id} version={study.version} allowedActions={permissions.allowedActions} />
        </Section>
      )}

      {study.resolvedOutcome && (
        <Section id="outcome" title="Resolved outcome" description="Verified against documented evidence by an authorized resolver.">
          <p className="text-2xl font-semibold">{study.resolvedOutcome}</p>
          <p className="text-sm text-slate-500">Resolved {formatDate(study.resolvedAt)}</p>
          {estimate?.resolution?.evidenceSummary && <p className="mt-2 text-sm">{estimate.resolution.evidenceSummary}</p>}
          {estimate?.resolution?.evidenceUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block break-all text-sm underline">
              {url}
            </a>
          ))}
        </Section>
      )}

      {preOpen && (
        <Section
          id="opening-line"
          title="Opening line"
          description="Set by our model from the startup's data when forecasting opens, not by the proposing firm."
        >
          {openingLine?.status === "OK" ? (
            <div className="space-y-1 text-sm">
              <p className="text-2xl font-semibold tabular-nums">{Math.round(openingLine.probability! * 100)}%</p>
              <p className="text-slate-600 dark:text-slate-300">
                Model uncertainty {Math.round(openingLine.low! * 100)}–{Math.round(openingLine.high! * 100)}% · {openingLine.confidence}{" "}
                confidence · estimated {formatDateTime(openingLine.asOf)}
              </p>
              {openingLine.link && (
                <p className="text-slate-600 dark:text-slate-300">
                  Measured with {openingLine.metricLabel ?? openingLine.link.metricId}: at least{" "}
                  {openingLine.link.threshold.toLocaleString("en-US")} by {openingLine.link.targetDate}.
                </p>
              )}
              <p className="text-xs text-slate-500">
                The model estimates again with the latest data when forecasting opens, so the opening price can differ slightly.
              </p>
            </div>
          ) : (
            <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">Not enough data</p>
              <p className="mt-1">
                {openingLine?.status === "INSUFFICIENT_DATA"
                  ? `The model can't estimate ${openingLine.metricLabel ?? "this metric"} yet. ${openingLine.notes.at(-1) ?? ""}`
                  : "None of the model's metrics for this startup measures this question."}{" "}
                Forecasting can&apos;t open until the model has enough data to set an opening line.
              </p>
              {permissions.canEdit && <p className="mt-1">Edit the draft to link the question to a metric, or add your firm&apos;s figures.</p>}
            </div>
          )}
        </Section>
      )}

      <Section id="estimates" title="Estimates" description="Summary of public user, verified user, and model prediction markets.">
        <EstimateSummary baseline={baseline} estimate={estimate} freshness={freshness} />
        {uncertainty.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">
            {uncertainty.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="trend"
        title="Model, crowd and verified-user prices"
        description="Prediction lines from three different sources"
      >
        <ThreeLineChart marketId={study.marketId ?? study.id} points={history} baseline={baseline.value} />
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <MarketGaps estimate={estimate} history={history} now={now} />
        </div>
      </Section>

      <Section
        id="model-evidence"
        title="How the model got this number"
        description="The model's calculation and the exact data it used. Independent of trades."
      >
        <ModelCalculationPanel evidence={modelEvidence} />
      </Section>

      <Section
        id="company-signals"
        title="Other Company Signals"
        description="Context only. None of these signals inform this question's model."
      >
        <CompanySignalsPanel evidence={modelEvidence} news={evidence.news} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="definition" title="Question definition" description="How this question resolves. Set by the proposing firm and reviewed by Senzi.">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">Resolves YES if</dt>
              <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{study.yesCriteria}</dd>
            </div>
            <div>
              <dt className="font-medium">Resolves NO if</dt>
              <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{study.noCriteria}</dd>
            </div>
            {study.context && (
              <div>
                <dt className="font-medium">Context</dt>
                <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{study.context}</dd>
              </div>
            )}
            <div>
              <dt className="font-medium">Visibility</dt>
              <dd className="text-slate-700 dark:text-slate-300">{VISIBILITY_LABELS[study.visibility].description}</dd>
            </div>
          </dl>
        </Section>

        <Section id="sources" title="Cited sources" description="Public information cited by the proposing firm. Not independently verified unless noted.">
          {study.sources.length === 0 ? (
            <p className="text-sm text-slate-500">No sources cited.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {study.sources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium underline">
                    {s.title}
                  </a>
                  <span className="block text-xs text-slate-500">
                    {[s.publisher, s.publishedAt && formatDate(s.publishedAt)].filter(Boolean).join(" · ") || new URL(s.url).hostname}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {full && participants && (
        <Section
          id="participants"
          title="Invited participants"
          description={PARTICIPANT_SCOPE[study.visibility]}
        >
          <ParticipantsEditor studyId={study.id} participants={participants} canManage={permissions.canManageParticipants} />
        </Section>
      )}

      {permissions.canViewPrivate && (
        <Section id="notes" title="Private notes" description="Visible only to your firm. Never shared publicly or with participants.">
          <NotesPanel
            studyId={study.id}
            initialNotes={notes}
            canWrite={permissions.canWriteNotes}
            currentUserId={ctx.user.id}
            authors={authors}
          />
        </Section>
      )}

      <Section id="timeline" title="Timeline">
        <ol className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="text-slate-500">{formatDateTime(e.createdAt)}</span>
              <span>{STATUS_LABELS[e.toStatus]}</span>
              {full && <span className="text-slate-500">by {e.actorId ? authors[e.actorId] ?? "a reviewer" : "system"}</span>}
              {e.reason && <span className="text-slate-500">— {e.reason}</span>}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
