import About from "@/app/(marketing)/_site/pages/About";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/about",
  title: "About",
  description: "The story, the people and the principles behind PizzaDAO, the world's largest pizza co-op.",
});

export default function Page() {
  return <About />;
}
