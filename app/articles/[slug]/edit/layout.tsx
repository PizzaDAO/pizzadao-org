import type { Metadata } from "next";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Edit article",
  description: "Edit a PizzaDAO article.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
