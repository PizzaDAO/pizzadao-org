import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Members",
  description: "The PizzaDAO member directory.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
