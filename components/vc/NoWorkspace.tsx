import Link from "next/link";

/** Shown to signed-in users without a VC organization membership. */
export function NoWorkspace() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-950">
      <h1 className="text-lg font-semibold">No VC workspace</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        VentureCast Intelligence is available to members of venture capital firms. Ask your firm&apos;s admin to invite
        you. If you were invited to a specific study, open it from the link you received.
      </p>
      <Link href="/vc/studies?scope=participating" className="mt-4 inline-block text-sm underline">
        Studies I&apos;m invited to
      </Link>
    </div>
  );
}
