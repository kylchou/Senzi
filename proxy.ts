import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Optimistic redirect to sign-in for admin pages. This is NOT the security
// boundary: every route handler and page re-checks auth on the server via
// lib/auth.ts, and API routes answer 401/403 JSON instead of redirecting.
const isAdminPage = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAdminPage(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's frontend API proxy.
    "/__clerk/:path*",
  ],
};
