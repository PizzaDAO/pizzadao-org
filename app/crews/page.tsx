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

// Crew mappings come from public sheets through getCrewMappings(), which is
// already cached (KV + Next data cache, 5 min), so rendering per request is
// cheap. The viewer's own crews and join/leave still load in the client.

export default async function CrewsPage() {
  let crews = null;
  try {
    ({ crews } = await getCrewMappings());
  } catch {
    // Sheets unreachable: the client fetches /api/crew-mappings on mount.
  }
  return <CrewsClient initialCrews={crews} />;
}
