import Terms from "@/app/(marketing)/_site/pages/Terms";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/terms",
  title: "Terms & Conditions",
  description: "The terms that govern your use of pizzadao.org, our community channels, and the programs we organize together.",
});

export default function Page() {
  return <Terms />;
}
