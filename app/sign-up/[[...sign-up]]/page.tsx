import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { SignUpFlow } from "@/components/auth/SignUpFlow";

// Clerk's form reads the URL, so it needs a Suspense boundary under Cache Components.
export default function SignUpPage({ params }: PageProps<"/sign-up/[[...sign-up]]">) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Suspense>
        <Step params={params} />
      </Suspense>
    </div>
  );
}

/** Later steps (verify email, SSO callback) skip the picker; the choice is already on the sign-up. */
async function Step({ params }: { params: PageProps<"/sign-up/[[...sign-up]]">["params"] }) {
  const { "sign-up": rest } = await params;
  return rest?.length ? <SignUp forceRedirectUrl="/onboarding" /> : <SignUpFlow />;
}
