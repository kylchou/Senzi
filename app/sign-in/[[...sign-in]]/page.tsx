import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

// Clerk's form reads the URL, so it needs a Suspense boundary under Cache Components.
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
