import { notFound } from "next/navigation";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";
import { findSubjectDisavowals } from "@/app/lib/disavow/access";
import { getSession } from "@/app/lib/session";
import { loadDisavowRules } from "@/app/lib/disavow/rules";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { ResponseForm } from "../_components/ResponseForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only surface a listed member can reach. Shows their own entries (never
 * the nominator or the votes); anyone who is not a listed member gets a 404.
 */
export default async function DisavowResponsePage() {
    const session = await getSession().catch(() => null);
    if (!session?.discordId) notFound();
    const mine = await findSubjectDisavowals(session.discordId);
    if (mine.length === 0) notFound();
    const t = await getDisavowTranslator();
    const { appealCooldownDays } = await loadDisavowRules();
    return (
        <EditorialPage width="max-w-[720px]">
            <EditorialMasthead overline={t("overline")} title={t("response.title")} dek={t("response.intro")} />
            {mine.map((entry) => (
                <div key={entry.id} className="mb-8">
                    <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                        <h2 className="m-0 text-lg font-black">{t(`reasons.${entry.reason}`)}</h2>
                        <p className="m-0 whitespace-pre-wrap">{entry.statement}</p>
                        {entry.evidenceUrls.length > 0 && (
                            <ul className="m-0 list-disc pl-5">
                                {entry.evidenceUrls.map((u) => (
                                    <li key={u} className="break-all"><a href={u} target="_blank" rel="noopener noreferrer nofollow" className="underline">{u}</a></li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <ResponseForm entryId={entry.id} initial={entry.subjectResponse ?? ""} hasOpenRound={entry.rounds.length > 0} appealDays={appealCooldownDays} />
                </div>
            ))}
        </EditorialPage>
    );
}
