import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Missions",
  description: "Complete missions to level up in PizzaDAO.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
