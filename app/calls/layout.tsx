import type { Metadata } from "next";
import { RouteMessages } from "@/app/lib/i18n/RouteMessages";

// Metadata for a "use client" page (client pages can't export metadata).
export const metadata: Metadata = {
  title: "Calls",
  description: "Upcoming and recent PizzaDAO crew calls.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RouteMessages route="calls">{children}</RouteMessages>;
}
