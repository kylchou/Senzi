import type { Startup } from "@/generated/prisma/client";
import { StartupStage } from "@/generated/prisma/enums";
import type { ActionState } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, Select, TextArea } from "../_components/ui";

const stageOptions = Object.values(StartupStage).map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

export function StartupForm({
  action,
  startup,
  submitLabel,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  startup?: Startup;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required defaultValue={startup?.name} />
        <Field label="Slug" name="slug" required defaultValue={startup?.slug} hint="lowercase-with-hyphens" />
        <Field label="Industry" name="industry" required defaultValue={startup?.industry} />
        <Select label="Stage" name="stage" options={stageOptions} defaultValue={startup?.stage ?? StartupStage.SEED} />
        <Field label="Website" name="websiteUrl" type="url" defaultValue={startup?.websiteUrl ?? ""} />
        <Field label="Logo URL" name="logoUrl" type="url" defaultValue={startup?.logoUrl ?? ""} />
        <Field label="Founded" name="foundedYear" type="number" defaultValue={startup?.foundedYear ?? ""} />
        <Field label="Headquarters" name="headquarters" defaultValue={startup?.headquarters ?? ""} />
      </div>
      <Field label="Tagline" name="tagline" required defaultValue={startup?.tagline} />
      <TextArea label="Description" name="description" required defaultValue={startup?.description} />
      <Field
        label="Published (visible on the community site)"
        name="isPublished"
        type="checkbox"
        defaultChecked={startup?.isPublished ?? false}
      />
    </ActionForm>
  );
}
