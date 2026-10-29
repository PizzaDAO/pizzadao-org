import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { proposalsEnabled } from "@/app/lib/proposals/constants";

// Never cached and not indexed. The whole area answers 404 while proposals.enabled is off.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    robots: { index: false, follow: false, nocache: true },
};

export default async function ProposalsLayout({ children }: { children: ReactNode }) {
    if (!(await proposalsEnabled())) notFound();
    return <>{children}</>;
}
