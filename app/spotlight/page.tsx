// app/spotlight/page.tsx
//
// Mafia Spotlight (blackolive-55617). Logged-in members nominate themselves or
// another member for the community-call segment and see their past
// submissions. Admins triage at /admin/spotlight.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { SpotlightClient } from "./SpotlightClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("spotlight");
    return {
        title: t("overline").replace(/^§\s*/, ""),
        description: t("metaDescription"),
        robots: { index: false, follow: false },
    };
}

export default async function SpotlightPage() {
    const session = await getSession();

    if (!session?.discordId) {
        const t = await getTranslations("spotlight");
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div
                    className="paper-soft grid gap-4 rounded-[28px] border p-7 max-w-md w-full"
                    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                >
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("loginPrompt")}</p>
                    <Link
                        href="/login?returnTo=/spotlight"
                        className="btn-pill self-start"
                        style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}
                    >
                        {t("loginCta")}
                    </Link>
                </div>
            </main>
        );
    }

    return <SpotlightClient />;
}
