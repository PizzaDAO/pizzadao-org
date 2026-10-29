// app/admin/settings/page.tsx
//
// Admin-editable rules (plans/app-settings.md). Dread Pizza Roberts only, pinned to the role id
// (never a setting). The API routes enforce the same check on every request.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { SettingsEditor, type SettingsLabels } from "./SettingsEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminSettings");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default async function AdminSettingsPage() {
    const t = await getTranslations("adminSettings");
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/settings" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const labels: SettingsLabels = {
        codeDefault: t("codeDefault"),
        current: t("current"),
        modified: t("modified"),
        invalid: t("invalid"),
        stricterOnly: t("stricterOnly"),
        lastChanged: t("lastChanged", { who: "{who}", when: "{when}" }),
        save: t("save"),
        saving: t("saving"),
        saved: t("saved"),
        reset: t("reset"),
        resetting: t("resetting"),
        notePlaceholder: t("notePlaceholder"),
        confirmTitle: t("confirmTitle"),
        confirmYes: t("confirmYes"),
        confirmNo: t("confirmNo"),
        history: t("history"),
        hideHistory: t("hideHistory"),
        noHistory: t("noHistory"),
        recent: t("recent"),
        errorGeneric: t("errorGeneric"),
        changeLine: t("changeLine", { key: "{key}", from: "{from}", to: "{to}", who: "{who}" }),
        fromDefault: t("fromDefault"),
        toDefault: t("toDefault"),
        loadError: t("loadError"),
        empty: t("empty"),
        nonProdBanner: t("nonProdBanner"),
        on: t("on"),
        off: t("off"),
        emptyDefault: t("emptyDefault"),
        envForcedOff: t("envForcedOff", { env: "{env}" }),
        envFallback: t("envFallback", { env: "{env}" }),
        inForce: t("inForce"),
        idPlaceholder: t("idPlaceholder"),
        idsPlaceholder: t("idsPlaceholder"),
        incomeRole: t("incomeRole"),
        incomeAmount: t("incomeAmount"),
        incomeEvery: t("incomeEvery"),
        incomeRemove: t("incomeRemove"),
        addRow: t("addRow"),
        removeRow: t("removeRow"),
        listHint: t("listHint", { max: "{max}", chars: "{chars}" }),
        editedElsewhere: t("editedElsewhere"),
    };

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                    <p className="m-0 flex gap-4 text-sm">
                        <Link href="/admin/missions" className="underline">{t("linkMissions")}</Link>
                        <Link href="/admin/calls" className="underline">{t("linkCalls")}</Link>
                    </p>
                </header>
                <SettingsEditor labels={labels} />
            </div>
        </main>
    );
}
