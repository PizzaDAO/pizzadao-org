// app/admin/lanes/page.tsx
//
// Lane editor (plans/lane-cards-mission-onboarding.md). Dread Pizza Roberts only, pinned to the role id.
// The API route enforces the same check on every request.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { LanesEditor, type LanesLabels } from "./LanesEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminLanes");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

const LABEL_KEYS = [
    "nonProdBanner", "noLanes", "published", "draft", "preview", "tag", "laneTitle", "summary", "mission", "noMission",
    "stretch", "crew", "publish", "saveLane", "saving", "saved", "notePlaceholder", "steps", "noSteps", "stepTitle",
    "stepBody", "stepBodyHelp", "stepLink", "stepLinkLabel", "stepKind", "kindRead", "kindDo", "kindSubmit", "saveStep",
    "addStep", "deleteStep", "deleteConfirm", "moveUp", "moveDown", "recent", "noHistory", "errorGeneric", "loadError",
] as const;

export default async function AdminLanesPage() {
    const t = await getTranslations("adminLanes");
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/lanes" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const labels = Object.fromEntries(LABEL_KEYS.map((k) => [k, t(k)])) as unknown as LanesLabels;

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                    <p className="m-0 text-sm">
                        <Link href="/admin/settings" className="underline">{t("linkSettings")}</Link>
                        {" · "}
                        <Link href="/admin/missions" className="underline">{t("linkMissions")}</Link>
                    </p>
                </header>
                <LanesEditor labels={labels} />
            </div>
        </main>
    );
}
