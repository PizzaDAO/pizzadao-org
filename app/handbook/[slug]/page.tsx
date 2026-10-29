// One handbook chapter: Markdown from content/handbook/<slug>/<locale>.ts with admin-set facts
// filled in (plans/onboarding-guide.md). Dynamic because the language comes from a cookie.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { handbookPageDef, isHandbookSlug } from "@/content/handbook";
import { formatReviewed, getHandbookFacts, getHandbookPage, isStale, renderPlaceholders } from "@/app/lib/handbook";
import { resolveLocale } from "@/app/lib/i18n/get-locale";
import { HandbookMarkdown } from "@/app/ui/handbook/HandbookMarkdown";
import { LevelsTable } from "@/app/ui/handbook/LevelsTable";
import { EditorialMasthead, EditorialPage, pillOutline } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    if (!isHandbookSlug(slug)) return {};
    const page = await getHandbookPage(slug, await resolveLocale());
    return { title: page.title, description: page.dek, alternates: { canonical: `/handbook/${slug}` } };
}

export default async function HandbookChapterPage({ params }: Props) {
    const { slug } = await params;
    if (!isHandbookSlug(slug)) notFound();
    const locale = await resolveLocale();
    const t = await getTranslations("handbook");
    const [page, facts] = await Promise.all([getHandbookPage(slug, locale), getHandbookFacts(locale)]);
    const def = handbookPageDef(slug);
    const body = renderPlaceholders(page.body, facts);

    return (
        <EditorialPage width="max-w-3xl">
            <EditorialMasthead overline={t("overline")} title={page.title} dek={page.dek}>
                <nav className="flex flex-wrap gap-2.5" aria-label={t("pages")}>
                    <Link href="/handbook" className={pillOutline}>{`← ${t("back")}`}</Link>
                </nav>
            </EditorialMasthead>

            {page.fellBack && <p role="note" className="mt-0 mb-6 rounded-xl border border-[hsl(var(--rule-warm)/0.55)] p-3 text-sm">{t("notTranslated")}</p>}

            <HandbookMarkdown content={body} />
            {def.levelsTable && <LevelsTable />}

            <footer className="mt-12 grid gap-2 border-t border-[hsl(var(--rule-warm)/0.55)] pt-4 text-sm text-foreground/70">
                <p className="m-0">{t("lastReviewed", { date: formatReviewed(page.reviewed, locale) })}</p>
                {isStale(page.reviewed) && <p className="m-0">{t("outdated")}</p>}
                <p className="m-0">
                    {t("wrong")}{" "}
                    <Link href="/support" className="underline underline-offset-2">{t("wrongCta")}</Link>
                </p>
            </footer>
        </EditorialPage>
    );
}
