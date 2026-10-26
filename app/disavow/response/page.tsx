import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { findSubjectDisavowal } from "@/app/lib/disavow/access";
import { getSession } from "@/app/lib/session";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { ResponseForm } from "../_components/ResponseForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only surface a listed member can reach. Shows their own entry (never the
 * nominator or the votes); anyone who is not a listed member gets a 404.
 */
export default async function DisavowResponsePage() {
    const session = await getSession().catch(() => null);
    if (!session?.discordId) notFound();
    const mine = await findSubjectDisavowal(session.discordId);
    if (!mine) notFound();
    const t = await getTranslations("disavow");
    return (
        <EditorialPage width="max-w-[720px]">
            <EditorialMasthead overline={t("overline")} title={t("response.title")} dek={t("response.intro")} />
            <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                <h2 className="m-0 text-lg font-black">{t(`reasons.${mine.reason}`)}</h2>
                <p className="m-0 whitespace-pre-wrap">{mine.statement}</p>
                {mine.evidenceUrls.length > 0 && (
                    <ul className="m-0 list-disc pl-5">
                        {mine.evidenceUrls.map((u) => (
                            <li key={u} className="break-all"><a href={u} target="_blank" rel="noopener noreferrer nofollow" className="underline">{u}</a></li>
                        ))}
                    </ul>
                )}
            </section>
            <ResponseForm initial={mine.subjectResponse ?? ""} hasOpenRound={mine.rounds.length > 0} />
        </EditorialPage>
    );
}
