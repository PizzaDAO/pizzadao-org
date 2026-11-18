import Partners from "@/app/(marketing)/_site/pages/PartnersPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/partners",
  title: "Partners",
  description: "Partner with PizzaDAO: activations, sponsorships and brand collaborations with a global pizza community.",
});

export default function Page() {
  return <Partners />;
}
