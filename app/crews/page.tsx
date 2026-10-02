import type { Metadata } from "next";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import CrewsClient from "./CrewsClient";

export const metadata: Metadata = {
  title: "Crews",
  description: "PizzaDAO working groups and their weekly calls. Find a crew and join the call.",
  alternates: { canonical: "/crews" },
  openGraph: {
    title: "Crews · PizzaDAO",
    description: "PizzaDAO working groups and their weekly calls. Find a crew and join the call.",
    url: "/crews",
  },
};

// Crew mappings come from public sheets through getCrewMappings() (KV cache +
// Next data cache, 5 min). Regenerate the page on the same cadence; the
// viewer's own crews and join/leave still load in the client.
export const revalidate = 300;

export default async function CrewsPage() {
  let crews = null;
  try {
    ({ crews } = await getCrewMappings());
  } catch {
    // Sheets unreachable: the client fetches /api/crew-mappings on mount.
  }
  return <CrewsClient initialCrews={crews} />;
}
