import { notFound, ok, withApiHandler } from "@/lib/api-response";
import { getStartupProfile } from "@/lib/discovery/queries";

export const GET = withApiHandler(async (_req, { params }: RouteContext<"/api/startups/[slug]">) => {
  const startup = await getStartupProfile((await params).slug);
  if (!startup) throw notFound("Startup");
  return ok(startup);
});
