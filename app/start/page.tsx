import type { Metadata } from "next";

// The onboarding wizard's own address. "/" serves the same page until the marketing home takes it
// over (NEXT_PUBLIC_MARKETING_HOME_AT_ROOT, see next.config.ts); after that the wizard is only here.
export { default } from "../page";

export const metadata: Metadata = {
  title: { absolute: "Start · PizzaDAO" },
  description: "New to PizzaDAO? Start here: meet the crews, get your mafia name and find your first mission.",
};
