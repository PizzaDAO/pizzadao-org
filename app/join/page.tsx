// app/join/page.tsx
//
// Deep-link entry point that drops users directly into the onboarding
// wizard at step 1 (Pick your mafia name), skipping the welcome screen.
// Use this URL for sharing in places like the Discord channel where the
// welcome card is redundant.

import { OnboardingWizard } from "../ui/onboarding";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join PizzaDAO",
  description: "Pick your mafia name and join the international pizza co-op.",
};

export default function JoinPage() {
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
        <OnboardingWizard
          initialFlow={{ type: "wizard", step: 1, isUpdate: false }}
        />
      </div>
    </main>
  );
}
