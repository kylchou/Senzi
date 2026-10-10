import { notFound, redirect } from "next/navigation";
import { VcError } from "../errors";
import type { VcContext } from "../types";
import { getVcContext } from "./context";

export function signInUrl(returnTo: string) {
  const base = process.env.NEXT_PUBLIC_SIGN_IN_URL ?? "/sign-in";
  return `${base}?redirect_url=${encodeURIComponent(returnTo)}`;
}

/** For server components: returns the VC context or redirects to sign-in. */
export async function requirePageContext(returnTo: string): Promise<VcContext> {
  const ctx = await getVcContext();
  if (!ctx) redirect(signInUrl(returnTo));
  return ctx;
}

/** Maps hidden/missing resources to the 404 page; rethrows everything else. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof VcError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
