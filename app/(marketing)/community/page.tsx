import Community from "@/app/(marketing)/_site/pages/CommunityPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";
import { getPublicLaneLinks } from "@/app/lib/lanes";

export const metadata = pageMeta({
  path: "/community",
  title: "Community",
  description: "PizzaDAO's community: city chapters, weekly calls, events, builds and the public calendar.",
});

// The lane cards link to their guides only while the lane cards setting is on and the lane is
// published (plans/lane-cards-mission-onboarding.md). The page is prerendered and revalidated every
// 5 minutes; getPublicLaneLinks caches the lane list (tag `lane-links`, expired by the admin lane
// writes, which also expires this page). Any failure means no links (getPublicLaneLinks never throws).
// force-static empties cookies()/headers() for the render, so nothing personal can be cached.
export const dynamic = "force-static";
export const revalidate = 300;

export default async function Page() {
  const laneLinks = await getPublicLaneLinks();
  return <Community laneLinks={laneLinks} />;
}
