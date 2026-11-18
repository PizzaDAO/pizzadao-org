import Contact from "@/app/(marketing)/_site/pages/ContactPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/contact",
  title: "Contact",
  description: "Get in touch with PizzaDAO about partnerships, press, events or joining the community.",
});

export default function Page() {
  return <Contact />;
}
