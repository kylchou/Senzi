import { requireAdminPage } from "@/lib/auth";
import { createStartupAction } from "../../actions";
import { PageHeader } from "../../_components/ui";
import { StartupForm } from "../startup-form";

export default async function NewStartupPage() {
  await requireAdminPage("/admin/startups/new");
  return (
    <>
      <PageHeader title="New startup" />
      <StartupForm action={createStartupAction} submitLabel="Create startup" />
    </>
  );
}
