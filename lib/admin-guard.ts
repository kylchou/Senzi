import { PlatformRole } from "@/generated/prisma/enums";
import { forbidden } from "@/lib/api-response";
import type { SessionUser } from "@/lib/types";

/** Every admin service re-checks the role, so callers can't forget it. */
export function assertAdmin(actor: Pick<SessionUser, "platformRole">) {
  if (actor.platformRole !== PlatformRole.ADMIN) throw forbidden("Administrator access required");
}
