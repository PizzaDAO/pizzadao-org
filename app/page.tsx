import { OnboardingWizard } from "./ui/onboarding";

export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <OnboardingWizard />
    </main>
  );
}
