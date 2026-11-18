import Terms from "@/app/(marketing)/_site/pages/Terms";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/terms",
  title: "Terms & Conditions",
  description: "The terms that govern your use of pizzadao.org, our community channels, and the programs we organize together.",
});

export default function Page() {
  return <Terms />;
}
