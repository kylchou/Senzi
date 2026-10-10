import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { StudyForm } from "@/components/vc/StudyForm";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function NewStudyPage() {
  const ctx = await requirePageContext("/vc/studies/new");
  if (!ctx.activeOrg) return <NoWorkspace />;
  if (!canProposeInActiveOrg(ctx)) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm dark:border-slate-800 dark:bg-slate-950">
        Your role in {ctx.activeOrg.organizationName} is read-only. Ask an admin for analyst access to propose studies.
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Propose a research study</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Saved as a draft for {ctx.activeOrg.organizationName}. Submit it for platform review when ready; approved studies
          open for community forecasting with virtual credits.
        </p>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <StudyForm />
      </div>
    </div>
  );
}
