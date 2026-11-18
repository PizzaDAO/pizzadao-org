import About from "@/app/(marketing)/_site/pages/About";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/about",
  title: "About",
  description: "The story, the people and the principles behind PizzaDAO, the world's largest pizza co-op.",
});

export default function Page() {
  return <About />;
}
