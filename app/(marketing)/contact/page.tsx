import Contact from "@/app/(marketing)/_site/pages/ContactPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/contact",
  title: "Contact",
  description: "Get in touch with PizzaDAO about partnerships, press, events or joining the community.",
});

export default function Page() {
  return <Contact />;
}
