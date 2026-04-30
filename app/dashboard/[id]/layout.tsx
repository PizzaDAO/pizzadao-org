"use client";

import dynamic from "next/dynamic";

const Web3Providers = dynamic(
  () => import("@/app/lib/web3-providers").then(m => ({ default: m.Web3Providers })),
  { ssr: false }
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Web3Providers>{children}</Web3Providers>;
}
