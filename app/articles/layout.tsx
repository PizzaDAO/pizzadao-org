import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Articles",
  description: "Stories, updates and essays from the PizzaDAO family.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
