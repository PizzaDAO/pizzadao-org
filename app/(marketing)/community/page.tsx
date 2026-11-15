import Community from "@/app/(marketing)/_site/pages/CommunityPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";
import { getPublicLaneLinks } from "@/app/lib/lanes";

export const metadata = pageMeta({
  path: "/community",
  title: "Community",
  description: "PizzaDAO's community: city chapters, weekly calls, events, builds and the public calendar.",
});

// The lane cards link to their guides only while the lane cards setting is on and the lane is
// published (plans/lane-cards-mission-onboarding.md). The page is dynamic (the root layout reads
// cookies), so there is no page-level revalidate; getPublicLaneLinks caches the lane list for a
// short time (tag `lane-links`, expired by the admin lane writes). Any failure means no links
// (getPublicLaneLinks never throws).

export default async function Page() {
  const laneLinks = await getPublicLaneLinks();
  return <Community laneLinks={laneLinks} />;
}
