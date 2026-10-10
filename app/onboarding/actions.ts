"use server";

import { redirect } from "next/navigation";
import { chooseAccountType, homePathFor, parseAccountType, requireUser } from "@/lib/auth";

export async function chooseAccountTypeAction(fd: FormData) {
  const type = parseAccountType(fd.get("accountType"));
  if (!type) redirect("/onboarding");
  const user = await chooseAccountType(await requireUser(), type);
  redirect(homePathFor(user.accountType));
}
