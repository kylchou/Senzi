import { withApiHandler } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/auth";
import { getScreenshot } from "@/lib/product-verification";

/** A product-user screenshot, for admins reviewing it. Never cached. */
export const GET = withApiHandler(async (_req, ctx: RouteContext<"/api/admin/product-verifications/[id]/screenshot">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { bytes, type } = await getScreenshot(admin, id);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
