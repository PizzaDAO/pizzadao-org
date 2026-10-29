// app/admin/missions/page.tsx
//
// Mission editor (plans/app-settings.md 4.7). Dread Pizza Roberts only, pinned to the role id.
// The API route enforces the same check on every request.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { MissionsEditor, type MissionsLabels } from "./MissionsEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminMissions");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default async function AdminMissionsPage() {
    const t = await getTranslations("adminMissions");
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/missions" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const labels: MissionsLabels = {
        nonProdBanner: t("nonProdBanner"),
        level: t("level", { level: "{level}" }),
        levelTitle: t("levelTitle"),
        reward: t("reward"),
        rewardsDisagree: t("rewardsDisagree"),
        saveLevel: t("saveLevel"),
        missionTitle: t("missionTitle"),
        missionDescription: t("missionDescription"),
        guideLink: t("guideLink"),
        guideLinkHelp: t("guideLinkHelp"),
        active: t("active"),
        verifier: t("verifier"),
        manualVerifier: t("manualVerifier"),
        params: t("params"),
        paramsHelp: t("paramsHelp"),
        rewardLowerOnly: t("rewardLowerOnly"),
        activeOnlyEnable: t("activeOnlyEnable"),
        saveMission: t("saveMission"),
        saving: t("saving"),
        saved: t("saved"),
        notePlaceholder: t("notePlaceholder"),
        confirmTitle: t("confirmTitle"),
        confirmYes: t("confirmYes"),
        confirmNo: t("confirmNo"),
        recent: t("recent"),
        noHistory: t("noHistory"),
        errorGeneric: t("errorGeneric"),
        loadError: t("loadError"),
    };

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                    <p className="m-0 text-sm">
                        <Link href="/admin/settings" className="underline">{t("linkSettings")}</Link>
                    </p>
                </header>
                <MissionsEditor labels={labels} />
            </div>
        </main>
    );
}
