import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Crews",
  description: "PizzaDAO working groups and their weekly calls.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
