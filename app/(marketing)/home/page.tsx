import Index from "@/app/(marketing)/_site/pages/Index";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Served at /home until NEXT_PUBLIC_MARKETING_HOME_AT_ROOT moves it to "/" (see next.config.ts).
export const metadata = pageMeta({
  path: "/",
  title: "PizzaDAO",
  absoluteTitle: true,
  description: "PizzaDAO is a global community using pizza, art, and internet culture to support local businesses and bring people together.",
});

export default function Page() {
  return <Index />;
}
