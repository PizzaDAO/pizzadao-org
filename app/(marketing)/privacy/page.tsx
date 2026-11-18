import Privacy from "@/app/(marketing)/_site/pages/Privacy";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/privacy",
  title: "Privacy Policy",
  description: "What PizzaDAO collects, why, and how to control it.",
});

export default function Page() {
  return <Privacy />;
}
