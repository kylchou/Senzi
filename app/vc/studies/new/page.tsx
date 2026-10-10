import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { StudyForm } from "@/components/vc/StudyForm";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function NewStudyPage() {
  const ctx = await requirePageContext("/vc/studies/new");
  if (!ctx.activeOrg) return <NoWorkspace />;
  if (!canProposeInActiveOrg(ctx)) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm dark:border-slate-800 dark:bg-slate-950">
        Your role in {ctx.activeOrg.organizationName} is read-only. Ask an admin for analyst access to ask questions.
      </p>
    );
  }
  const catalog = await getVcServices().openingLine.questionCatalog();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Ask a question</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Saved as a draft for {ctx.activeOrg.organizationName}. Submit it for review when ready; once approved, forecasting opens at the
          model&apos;s price for the traders you choose.
        </p>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <StudyForm catalog={catalog} />
      </div>
    </div>
  );
}
