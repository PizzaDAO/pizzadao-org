import type { Metadata } from "next";
import { OnboardingWizard } from "./ui/onboarding";
import { RouteMessages } from "@/app/lib/i18n/RouteMessages";

export const metadata: Metadata = {
  title: { absolute: "Join PizzaDAO" },
};

export default function Page() {
  return (
    <RouteMessages route="">
    <main className="bg-background text-foreground min-h-screen">
      <h1 className="sr-only">Welcome to PizzaDAO</h1>
      {/* Subtle warm gradient backdrop reminiscent of pizzadao.org hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, hsl(var(--tomato) / 0.10), transparent 70%)",
        }}
      />
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-24">
        <OnboardingWizard />
      </div>
    </main>
    </RouteMessages>
  );
}
