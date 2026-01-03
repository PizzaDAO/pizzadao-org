import OnboardingWizard from "./ui/OnboardingWizard";

export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 34, marginBottom: 8 }}>PizzaDAO Mafia Name Onboarding</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Pick your name, city, turtle, and crews.
      </p>
      <OnboardingWizard />
    </main>
  );
}
