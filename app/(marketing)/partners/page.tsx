import Partners from "@/app/(marketing)/_site/pages/PartnersPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/partners",
  title: "Partners",
  description: "Partner with PizzaDAO: activations, sponsorships and brand collaborations with a global pizza community.",
});

export default function Page() {
  return <Partners />;
}
