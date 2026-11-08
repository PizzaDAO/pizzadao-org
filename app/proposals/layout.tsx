import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { proposalsEnabled } from "@/app/lib/proposals/constants";
import { toggleEnabled } from "@/app/lib/settings/toggles";

// Never cached and not indexed. The whole area answers 404 unless voting (proposals.enabled) or the
// history (proposals.historyEnabled) is on; the pages hide voting while only the history is on.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    robots: { index: false, follow: false, nocache: true },
};

export default async function ProposalsLayout({ children }: { children: ReactNode }) {
    const [voting, history] = await Promise.all([
        proposalsEnabled(),
        toggleEnabled("proposals.historyEnabled").catch(() => false),
    ]);
    if (!voting && !history) notFound();
    return <>{children}</>;
}
