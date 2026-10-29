// Handbook index: chapter cards grouped by audience, plus the signed-in member's next mission.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { HANDBOOK_PAGES, type HandbookGroup } from "@/content/handbook";
import { getHandbookPage } from "@/app/lib/handbook";
import { resolveLocale } from "@/app/lib/i18n/get-locale";
import { getSession } from "@/app/lib/session";
import { getMissionsOverview } from "@/app/lib/missions-overview";
import { pickNextMission, type NextMission } from "@/app/lib/next-mission";
import { EditorialMasthead, EditorialPage, paperCard, pillTomato } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("handbook");
    return { title: t("metaTitle"), description: t("metaDescription"), alternates: { canonical: "/handbook" } };
}

interface Card {
    key: string;
    href: string;
    title: string;
    dek: string;
    group: HandbookGroup;
}

const GROUP_ORDER: HandbookGroup[] = ["newMember", "hosting", "takingPart"];

async function NextMissionBlock() {
    const t = await getTranslations("handbook.next");
    const session = await getSession();
    let next: NextMission | null = null;
    if (session?.discordId) {
        try {
            next = pickNextMission(await getMissionsOverview(session.discordId));
        } catch {
            next = null;
        }
    }
    return (
        <section className="ink-bottom mb-8 rounded-[var(--radius)] bg-foreground p-5 text-background sm:p-6" aria-label={t("title")}>
            <p className="overline m-0">{t("title")}</p>
            {!session ? (
                <>
                    <p className="my-2">{t("login")}</p>
                    <Link href="/login?returnTo=/handbook" className={pillTomato}>{t("login")}</Link>
                </>
            ) : (
                <>
                    {next && (
                        <>
                            <p className="font-display my-2 text-xl font-black">{next.title}</p>
                            <p className="mb-3 mt-0 opacity-80">{t("level", { level: next.level })}</p>
                        </>
                    )}
                    <Link href="/missions" className={pillTomato}>{t("cta")}</Link>
                </>
            )}
        </section>
    );
}

export default async function HandbookIndexPage() {
    const t = await getTranslations("handbook");
    const locale = await resolveLocale();

    const cards: Card[] = await Promise.all(
        HANDBOOK_PAGES.map(async (p) => {
            const page = await getHandbookPage(p.slug, locale);
            return { key: p.slug, href: `/handbook/${p.slug}`, title: page.title, dek: page.dek, group: p.group };
        }),
    );
    // Existing pages that are part of the handbook but keep their own URL.
    cards.push(
        { key: "attend", href: "/calls/how-to-attend", title: t("chapters.attend.title"), dek: t("chapters.attend.dek"), group: "newMember" },
        { key: "crewManuals", href: "/manuals", title: t("chapters.crewManuals.title"), dek: t("chapters.crewManuals.dek"), group: "takingPart" },
    );

    return (
        <EditorialPage width="max-w-3xl">
            <EditorialMasthead
                overline={t("overline")}
                title={<>{t("titlePrefix")} <span className="text-tomato-readable underline-scribble">{t("titleAccent")}</span></>}
                dek={t("dek")}
            />

            <Suspense fallback={null}>
                <NextMissionBlock />
            </Suspense>

            {GROUP_ORDER.map((group) => {
                const items = cards.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                    <section key={group} className="mb-8" aria-label={t(`groups.${group}`)}>
                        <h2 className="font-display mb-3 mt-0 text-2xl font-black">{t(`groups.${group}`)}</h2>
                        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                            {items.map((c) => (
                                <li key={c.key}>
                                    <Link href={c.href} className={`${paperCard} block h-full p-4 no-underline sm:p-5`}>
                                        <span className="font-display block text-lg font-black">{c.title}</span>
                                        <span className="mt-1 block text-sm text-foreground/70">{c.dek}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </EditorialPage>
    );
}
