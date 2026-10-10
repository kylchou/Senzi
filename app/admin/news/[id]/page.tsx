import { listAdminStartups } from "@/lib/admin";
import { getAdminNewsItem } from "@/lib/admin-content";
import { requireAdminPage } from "@/lib/auth";
import { updateNewsAction } from "../../actions";
import { PageHeader } from "../../_components/ui";
import { NewsForm } from "../news-form";

export default async function EditNewsPage({ params }: PageProps<"/admin/news/[id]">) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/news/${id}`);
  const [item, startups] = await Promise.all([getAdminNewsItem(admin, id), listAdminStartups(admin)]);

  return (
    <>
      <PageHeader title="Edit article" />
      <NewsForm action={updateNewsAction.bind(null, item.id)} item={item} startups={startups} submitLabel="Save" />
    </>
  );
}
