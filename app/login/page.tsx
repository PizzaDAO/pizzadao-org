// app/login/page.tsx
//
// Deep-link entry point for the magic-link login flow. Mounts the wizard
// in the magic_login state so the URL bar reads /login while the user is
// using the "DM me a login link" surface.
//
// See app/ui/onboarding/MagicLoginFlow.tsx for the actual form.

import { OnboardingWizard } from "../ui/onboarding";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login · PizzaDAO",
  description: "Login via Discord DM.",
};

export default function LoginPage() {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, hsl(var(--tomato) / 0.10), transparent 70%)",
        }}
      />
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-24">
        <OnboardingWizard initialFlow={{ type: "magic_login" }} />
      </div>
    </main>
  );
}
