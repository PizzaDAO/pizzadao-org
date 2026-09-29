import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Tech Projects",
  description: "Open-source projects from the PizzaDAO tech crew.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
