import Privacy from "@/app/(marketing)/_site/pages/Privacy";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/privacy",
  title: "Privacy Policy",
  description: "What PizzaDAO collects, why, and how to control it.",
});

export default function Page() {
  return <Privacy />;
}
