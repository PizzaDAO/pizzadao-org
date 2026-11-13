import Community from "@/app/(marketing)/_site/pages/CommunityPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/community",
  title: "Community",
  description: "PizzaDAO's community: city chapters, weekly calls, events, builds and the public calendar.",
});

export default function Page() {
  return <Community />;
}
