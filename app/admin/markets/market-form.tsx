import type { Market } from "@/generated/prisma/client";
import { MarketVisibility } from "@/generated/prisma/enums";
import type { ActionState } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, Select, TextArea, toUtcInputValue } from "../_components/ui";

const visibilityOptions = [
  { value: MarketVisibility.PUBLIC, label: "Public" },
  { value: MarketVisibility.UNLISTED, label: "Unlisted (direct link only)" },
  { value: MarketVisibility.PRIVATE, label: "Private (one organization)" },
];

export function MarketForm({
  action,
  market,
  startups,
  organizations,
  defaultStartupId,
  termsLocked = false,
  submitLabel,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  market?: Market;
  startups: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  defaultStartupId?: string;
  termsLocked?: boolean;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {termsLocked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          People have already forecast on this market, so the question, criteria, baseline, startup,
          visibility, and open time are locked. You can still adjust dates and descriptions.
        </p>
      )}
      <fieldset disabled={termsLocked} className="space-y-4 disabled:opacity-60">
        <Select
          label="Startup"
          name="startupId"
          defaultValue={market?.startupId ?? defaultStartupId}
          options={startups.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Field
          label="Question"
          name="question"
          required
          defaultValue={market?.question}
          hint="A YES/NO question ending in “?”"
        />
        <TextArea
          label="Resolution criteria"
          name="resolutionCriteria"
          required
          defaultValue={market?.resolutionCriteria}
          hint="Exactly what has to happen, by when, for this to resolve YES."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Opening baseline (%)"
            name="openingBaselinePercent"
            type="number"
            min={1}
            max={99}
            step={0.1}
            required
            defaultValue={market ? Math.round(market.openingBaseline * 1000) / 10 : 50}
            hint="Admin starting estimate. Not a community signal."
          />
          <Select
            label="Visibility"
            name="visibility"
            defaultValue={market?.visibility ?? MarketVisibility.PUBLIC}
            options={visibilityOptions}
          />
          <Select
            label="Organization (private markets only)"
            name="organizationId"
            defaultValue={market?.organizationId ?? ""}
            options={[{ value: "", label: "—" }, ...organizations.map((o) => ({ value: o.id, label: o.name }))]}
          />
          <Field label="Opens (UTC)" name="opensAt" type="datetime-local" required defaultValue={toUtcInputValue(market?.opensAt)} />
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Slug" name="slug" required defaultValue={market?.slug} />
        <Field label="Category" name="category" defaultValue={market?.category ?? ""} />
        <Field label="Deadline (UTC)" name="closesAt" type="datetime-local" required defaultValue={toUtcInputValue(market?.closesAt)} />
        <Field label="Resolve by (UTC)" name="resolvesBy" type="datetime-local" defaultValue={toUtcInputValue(market?.resolvesBy)} />
      </div>
      <Field label="Resolution source" name="resolutionSource" defaultValue={market?.resolutionSource ?? ""} hint="Where the resolver will look, e.g. SEC filings or the company blog." />
      <TextArea label="Description" name="description" defaultValue={market?.description ?? ""} />
      {!market && <Field label="Open immediately" name="openImmediately" type="checkbox" />}
    </ActionForm>
  );
}
