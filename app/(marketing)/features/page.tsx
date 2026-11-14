import { notFound } from "next/navigation";
import { pageMeta } from "@/app/(marketing)/_site/meta";
import { getPublicCatalog, loadSwitches } from "@/app/lib/features/service";
import FeaturesView from "./FeaturesView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/features",
  title: "What we have built",
  description: "What PizzaDAO has built for members, event hosts, pizzerias and builders, with live links and the code behind each feature.",
});

export default async function Page() {
  // Off (the default): the page does not exist, so nothing is announced before an admin has reviewed the rows.
  // The switch is read before any row, and a failed read counts as off.
  const switches = await loadSwitches().catch(() => null);
  if (!switches?.publicEnabled) notFound();
  const loaded = await getPublicCatalog().catch(() => null);
  if (!loaded) notFound();
  return <FeaturesView catalog={loaded.catalog} intro={switches.introText} contributeUrl={switches.contributeUrl} />;
}
