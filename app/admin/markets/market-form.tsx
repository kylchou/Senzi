import type { Market } from "@/generated/prisma/client";
import { MarketVisibility } from "@/generated/prisma/enums";
import type { ActionState } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, Select, TextArea, toUtcInputValue } from "../_components/ui";

const visibilityOptions = [
  { value: MarketVisibility.PUBLIC, label: "Public" },
  { value: MarketVisibility.ORGANIZATION, label: "Organization members" },
  { value: MarketVisibility.RESTRICTED, label: "Restricted (org admins and invitees)" },
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
  market?: Market & { sources?: { title: string; url: string }[] };
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
          This market is open, so its terms are locked: question, criteria, baseline, startup, visibility,
          sources, and limits. You can still change the description, category, deadline, and resolve-by date.
          Every change is recorded in the audit log.
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
          label="Resolves YES if"
          name="yesCriteria"
          required
          defaultValue={market?.yesCriteria}
          hint="Exactly what has to happen, by when."
        />
        <TextArea
          label="Resolves NO if"
          name="noCriteria"
          required
          defaultValue={market?.noCriteria}
          hint="Usually: the YES criteria aren't met by the deadline."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Opening baseline (%)"
            name="openingBaselinePercent"
            type="number"
            min={1}
            max={99}
            step={0.1}
            defaultValue={market?.openingBaseline != null ? Math.round(market.openingBaseline * 1000) / 10 : ""}
            hint="Optional starting estimate. Not a community signal."
          />
          <Field
            label="Baseline methodology"
            name="baselineMethodology"
            defaultValue={market?.baselineMethodology ?? ""}
            hint="Required with a baseline, e.g. base rate of Series B within 18 months of an A."
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
        <Field label="Slug" name="slug" required defaultValue={market?.slug} disabled={termsLocked} />
        <Field label="Category" name="category" defaultValue={market?.category ?? ""} />
        <Field label="Deadline (UTC)" name="closesAt" type="datetime-local" required defaultValue={toUtcInputValue(market?.closesAt)} />
        <Field label="Resolve by (UTC)" name="resolvesBy" type="datetime-local" defaultValue={toUtcInputValue(market?.resolvesBy)} />
      </div>
      <TextArea
        label="Resolution sources"
        name="sources"
        disabled={termsLocked}
        rows={3}
        required
        defaultValue={market?.sources?.map((s) => `${s.title} | ${s.url}`).join("\n") ?? ""}
        hint="Where the resolver will look. One per line: Title | https://link"
      />
      {!termsLocked && <input type="hidden" name="verifiedUsersOnlyField" value="1" />}
      <Field
        label="Verified users only (people who proved they use this startup's product)"
        name="verifiedUsersOnly"
        type="checkbox"
        defaultChecked={market?.verifiedUsersOnly ?? false}
        disabled={termsLocked}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Min credits per forecast" name="minForecastCredits" type="number" min={1} defaultValue={market?.minForecastCredits ?? ""} disabled={termsLocked} />
        <Field label="Max credits per forecast" name="maxForecastCredits" type="number" min={1} defaultValue={market?.maxForecastCredits ?? ""} disabled={termsLocked} />
      </div>
      <TextArea label="Description" name="description" defaultValue={market?.description ?? ""} />
      {!market && <Field label="Open immediately" name="openImmediately" type="checkbox" />}
    </ActionForm>
  );
}
