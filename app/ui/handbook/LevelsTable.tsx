// The level list on /handbook/levels, built live from Mission rows so the page never restates a
// number that lives in the database (rewards, mission titles, vouch counts). Anchors level-N.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getMissionsOverview, type MissionsOverview } from "@/app/lib/missions-overview";
import { paperCard, pillOutline } from "@/app/ui/shared/Editorial";

export async function LevelsTable() {
    const t = await getTranslations("handbook.levels");
    let levels: MissionsOverview["levels"] | null = null;
    try {
        levels = (await getMissionsOverview(null)).levels;
    } catch {
        levels = null;
    }

    if (!levels || levels.length === 0) {
        return (
            <section className={`${paperCard} p-4 sm:p-5 mt-8`} aria-label={t("tableTitle")}>
                <p className="m-0 mb-3 text-foreground/80">{t("unavailable")}</p>
                <Link href="/missions" className={pillOutline}>{t("seeMissions")}</Link>
            </section>
        );
    }

    const sorted = [...levels].sort((a, b) => a.level - b.level);
    return (
        <section className="mt-8 grid gap-4" aria-label={t("tableTitle")}>
            <h2 className="font-display text-2xl font-black m-0">{t("tableTitle")}</h2>
            {sorted.map((lvl) => (
                <article key={lvl.level} id={`level-${lvl.level}`} className={`${paperCard} p-4 sm:p-5 scroll-mt-20`}>
                    <h3 className="font-display text-xl font-black m-0">
                        {t("level", { n: lvl.level })}
                        {lvl.title ? <span className="text-foreground/70">{`: ${lvl.title}`}</span> : null}
                    </h3>
                    <p className="mt-1 mb-3 text-sm text-foreground/70">{t("reward", { pep: lvl.reward })}</p>
                    <ul className="m-0 grid gap-1 pl-5 list-disc">
                        {[...lvl.missions]
                            .sort((a, b) => a.index - b.index)
                            .map((m) => (
                                <li key={m.id}>{m.title}</li>
                            ))}
                    </ul>
                </article>
            ))}
            <div>
                <Link href="/missions" className={pillOutline}>{t("seeMissions")}</Link>
            </div>
        </section>
    );
}
