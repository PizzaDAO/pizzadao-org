import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Web3Shell } from "./Web3Shell";

// Server layout so the (client) dashboard page gets a title; the lazy
// Web3 providers live in the client-only Web3Shell.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard.page");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Web3Shell>{children}</Web3Shell>;
}
