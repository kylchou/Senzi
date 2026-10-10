import Link from "next/link";
import { NewsVerification } from "@/generated/prisma/enums";
import { listAdminStartups } from "@/lib/admin";
import { listAdminNews } from "@/lib/admin-content";
import { requireAdminPage } from "@/lib/auth";
import { createNewsAction, deleteNewsAction, setNewsVerificationAction } from "../actions";
import { ActionForm } from "../_components/action-form";
import { Badge, formatUtc, PageHeader, Section, Table } from "../_components/ui";
import { NewsForm } from "./news-form";

export default async function AdminNewsPage({ searchParams }: PageProps<"/admin/news">) {
  const admin = await requireAdminPage("/admin/news");
  const { verification: raw } = await searchParams;
  const verification = Object.values(NewsVerification).find((v) => v === raw);
  const [items, startups] = await Promise.all([
    listAdminNews(admin, { verification }),
    listAdminStartups(admin),
  ]);

  return (
    <>
      <PageHeader title="News" />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/news" className={!verification ? "font-semibold" : "text-zinc-500"}>All</Link>
        {Object.values(NewsVerification).map((v) => (
          <Link key={v} href={`/admin/news?verification=${v}`} className={verification === v ? "font-semibold" : "text-zinc-500"}>
            {v.toLowerCase()}
          </Link>
        ))}
      </div>

      <Section title={`Articles (${items.length})`}>
        <Table head={["Headline", "Startup", "Published", "Status", ""]}>
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="max-w-md py-2 pr-4">
                <Link className="hover:underline" href={`/admin/news/${item.id}`}>{item.title}</Link>
                <div className="text-xs text-zinc-500">{item.publisher}</div>
              </td>
              <td className="py-2 pr-4">{item.startup?.name ?? "—"}</td>
              <td className="whitespace-nowrap py-2 pr-4">{formatUtc(item.publishedAt)}</td>
              <td className="py-2 pr-4"><Badge>{item.verification}</Badge></td>
              <td className="space-y-2 py-2 pr-4">
                {Object.values(NewsVerification)
                  .filter((v) => v !== item.verification)
                  .map((v) => (
                    <ActionForm
                      key={v}
                      action={setNewsVerificationAction.bind(null, item.id)}
                      submitLabel={`Mark ${v.toLowerCase()}`}
                    >
                      <input type="hidden" name="verification" value={v} />
                    </ActionForm>
                  ))}
                <ActionForm action={deleteNewsAction.bind(null, item.id)} submitLabel="Delete" tone="danger" />
              </td>
            </tr>
          ))}
        </Table>
        {items.length === 0 && <p className="mt-2 text-sm text-zinc-500">No articles match.</p>}
      </Section>

      <Section title="Add an article">
        <NewsForm action={createNewsAction} startups={startups} submitLabel="Add article" />
      </Section>
    </>
  );
}
