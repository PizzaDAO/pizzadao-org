// app/proposals/new/page.tsx — new proposal form (the proposal template). Members only; the API checks the box.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { proposalsEnabledFor } from "@/app/lib/proposals/pilot";
import { loadProposalRules } from "@/app/lib/proposals/rules";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { EditorialPage } from "@/app/ui/shared/Editorial";
import { NewProposalForm } from "./NewProposalForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("proposals");
    return { title: t("form.meta"), robots: { index: false, follow: false } };
}

export default async function NewProposalPage() {
    // The area can be open for the history alone; creating proposals needs voting on.
    const session = await getSession().catch(() => null);
    if (!(await proposalsEnabledFor(session?.discordId).catch(() => false))) notFound();
    if (!session?.discordId) redirect("/login?returnTo=/proposals/new");
    // The ayes tiers as they are today, for the preview under the amount. Unreadable settings: no preview.
    const rules = await loadProposalRules().catch(() => null);
    const tiers = rules
        ? {
              capUsd: rules.policy.onApprovalCapUsd,
              midMaxUsd: rules.policy.voteMidMaxUsd,
              low: rules.policy.voteAyesLow,
              mid: rules.policy.voteAyesMid,
              high: rules.policy.voteAyesHigh,
              general: rules.generalAyes,
          }
        : null;
    return (
        <EditorialPage width="max-w-[720px]">
            <NewProposalForm tiers={tiers} />
        </EditorialPage>
    );
}
