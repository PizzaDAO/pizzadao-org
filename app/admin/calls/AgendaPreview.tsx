// Server component: the next crew-call agendas Metalhead would post (read-only preview).
import { getLocale, getTranslations } from "next-intl/server";
import { callAgendaEnabled, planAgendas } from "@/app/lib/call-agenda/run";

const HORIZON_MS = 48 * 60 * 60 * 1000;

export default async function AgendaPreview() {
    const t = await getTranslations("adminCalls");
    const locale = await getLocale();
    const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    let plans: Awaited<ReturnType<typeof planAgendas>> | null = null;
    try {
        plans = await planAgendas({ horizonMs: HORIZON_MS });
    } catch (err) {
        console.error("[admin/calls] agenda preview failed:", err instanceof Error ? err.message : err);
    }

    return (
        <section className="grid gap-3">
            <h2 className="font-[family-name:var(--font-display)] font-black text-xl m-0">{t("agendaTitle")}</h2>
            <p className="m-0 text-foreground/70">{t("agendaDescription")}</p>
            <p className="m-0 text-sm">{callAgendaEnabled() ? t("agendaOn") : t("agendaOff")}</p>
            {plans === null ? (
                <p className="text-foreground/60">{t("agendaError")}</p>
            ) : plans.length === 0 ? (
                <p className="text-foreground/60">{t("agendaNone")}</p>
            ) : (
                <div className="grid gap-3">
                    {plans.map((p) => (
                        <article key={`${p.eventId}:${p.startsAt.toISOString()}`} className="rounded-2xl border p-4 grid gap-2" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
                            <header className="flex flex-wrap items-baseline gap-x-3">
                                <strong>{p.crewLabel}</strong>
                                <span className="text-sm text-foreground/60">{when.format(p.startsAt)}</span>
                                <span className="text-sm">{p.excluded ? t("agendaExcluded") : p.alreadyPosted ? t("agendaPosted") : t("agendaPending")}</span>
                                <span className="text-sm text-foreground/60">{t("agendaChannel", { channel: p.channelRaw ?? t("agendaNoChannel") })}</span>
                            </header>
                            {p.filteredOut > 0 && <p className="m-0 text-sm text-tomato">{t("agendaOmitted", { count: p.filteredOut })}</p>}
                            {p.excluded ? (
                                <p className="m-0 text-foreground/60">{t("agendaExcludedNote")}</p>
                            ) : p.bullets.length === 0 ? (
                                <p className="m-0 text-foreground/60">{t("agendaNoItems")}</p>
                            ) : (
                                <pre className="m-0 whitespace-pre-wrap text-sm font-sans">{p.message}</pre>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
