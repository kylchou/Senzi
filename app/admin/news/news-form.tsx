import type { NewsItem } from "@/generated/prisma/client";
import { NewsVerification } from "@/generated/prisma/enums";
import type { ActionState } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Field, Select, TextArea, toUtcInputValue } from "../_components/ui";

const verificationOptions = [
  { value: NewsVerification.UNVERIFIED, label: "Unverified (reported, not checked)" },
  { value: NewsVerification.VERIFIED, label: "Verified against the source" },
  { value: NewsVerification.DISPUTED, label: "Disputed" },
];

export function NewsForm({
  action,
  item,
  startups,
  submitLabel,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  item?: NewsItem;
  startups: { id: string; name: string }[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <Field label="Headline" name="title" required defaultValue={item?.title} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Startup"
          name="startupId"
          defaultValue={item?.startupId ?? ""}
          options={[{ value: "", label: "—" }, ...startups.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <Field label="Publisher" name="publisher" required defaultValue={item?.publisher} />
        <Field label="URL" name="url" type="url" required defaultValue={item?.url} />
        <Field label="Published (UTC)" name="publishedAt" type="datetime-local" required defaultValue={toUtcInputValue(item?.publishedAt)} />
      </div>
      <TextArea label="Summary" name="summary" rows={3} defaultValue={item?.summary ?? ""} />
      <Select
        label="Verification"
        name="verification"
        defaultValue={item?.verification ?? NewsVerification.UNVERIFIED}
        options={verificationOptions}
      />
    </ActionForm>
  );
}
