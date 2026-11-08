// app/proposals/new/page.tsx — new proposal form (the proposal template). Members only; the API checks the box.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { proposalsEnabled } from "@/app/lib/proposals/constants";
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
    if (!(await proposalsEnabled().catch(() => false))) notFound();
    const session = await getSession().catch(() => null);
    if (!session?.discordId) redirect("/login?returnTo=/proposals/new");
    return (
        <EditorialPage width="max-w-[720px]">
            <NewProposalForm />
        </EditorialPage>
    );
}
