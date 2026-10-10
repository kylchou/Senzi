import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { identityFromClerkUser, provisionUser } from "@/lib/auth";
import { anonymizeDeletedUser, syncProfileFromAuth } from "@/lib/users";

/**
 * Clerk user lifecycle webhook. Signature is verified with
 * CLERK_WEBHOOK_SIGNING_SECRET. Users are also provisioned lazily on first
 * request, so this endpoint is about keeping profiles in sync.
 */
export async function POST(req: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "user.created": {
        const identity = identityFromClerkUser(event.data);
        if (identity) await provisionUser(identity);
        break;
      }
      case "user.updated": {
        const identity = identityFromClerkUser(event.data);
        if (identity) await syncProfileFromAuth(identity.authId, identity);
        break;
      }
      case "user.deleted":
        if (event.data.id) await anonymizeDeletedUser(event.data.id);
        break;
    }
  } catch (error) {
    console.error("[clerk-webhook] failed to handle", event.type, error);
    return new Response("Handler error", { status: 500 });
  }
  return new Response("ok");
}
