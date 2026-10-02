import type { Metadata } from "next";
import { getSession } from "@/app/lib/session";
import { getMissionsOverview, type MissionsOverview } from "@/app/lib/missions-overview";
import MissionsClient from "./MissionsClient";

export const metadata: Metadata = {
  title: "Missions",
  description: "Complete missions to level up in PizzaDAO and earn $PEP rewards.",
  alternates: { canonical: "/missions" },
  openGraph: {
    title: "Missions · PizzaDAO",
    description: "Complete missions to level up in PizzaDAO and earn $PEP rewards.",
    url: "/missions",
  },
};

// Per-viewer (progress + current level), so this renders on each request —
// the same work GET /api/missions did after hydration, minus a round trip.
export default async function MissionsPage() {
  let initial: MissionsOverview | null = null;
  try {
    const session = await getSession();
    initial = await getMissionsOverview(session?.discordId);
  } catch {
    // DB unavailable: the client falls back to fetching /api/missions.
    initial = null;
  }
  return <MissionsClient initial={initial} />;
}
