import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "POAPs",
  description: "PizzaDAO POAP events.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
