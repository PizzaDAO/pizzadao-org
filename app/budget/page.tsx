// app/budget/page.tsx
//
// Public budget guidelines (plans/host-fast-track.md phase 1). Every number comes from the
// `payments.*` settings; nothing is hard-coded in the prose. If the settings cannot be read, the
// amounts are hidden rather than showing the strict failure values.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loadPaymentPolicy } from "@/app/lib/payments/policy";
import { EditorialMasthead, EditorialPage, SectionHeading, paperCard, pillInk } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const revalidate = 30;

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("budget");
    return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function BudgetPage() {
    const t = await getTranslations("budget");
    const p = await loadPaymentPolicy();
    const usd = (n: number) => String(n.toLocaleString("en-US"));

    return (
        <EditorialPage width="max-w-[820px]">
            <EditorialMasthead overline={t("overline")} title={t("title")} dek={t("dek")} />

            {p.degraded && <p className={`${paperCard} p-4 mb-6 text-sm`}>{t("unavailable")}</p>}

            <div className="grid gap-6">
                <section className={`${paperCard} p-5`}>
                    <SectionHeading title={t("fundsTitle")} />
                    <p className="m-0">{t("fundsBody")}</p>
                </section>

                {!p.degraded && (
                    <section className={`${paperCard} p-5`}>
                        <SectionHeading title={t("capTitle")} />
                        <p className="mt-0">{t("capBody", { cap: usd(p.onApprovalCapUsd) })}</p>
                        <h3 className="font-display text-lg font-black mb-1">{t("votesTitle")}</h3>
                        <p className="mt-0">{t("votesBody", { cap: usd(p.onApprovalCapUsd) })}</p>
                        <ul className="m-0 pl-5">
                            <li>{t("tier2", { cap: usd(p.onApprovalCapUsd), tier2Max: usd(p.voteMidMaxUsd), ayes: p.voteAyesMid })}</li>
                            <li>{t("tier3", { tier2Max: usd(p.voteMidMaxUsd), ayes: p.voteAyesHigh })}</li>
                        </ul>
                    </section>
                )}

                <section className={`${paperCard} p-5`}>
                    <SectionHeading title={t("gppTitle")} />
                    <p className="m-0">{t("gppBody")}</p>
                </section>

                {!p.degraded && (
                    <section className={`${paperCard} p-5`}>
                        <SectionHeading title={t("receiptsTitle")} />
                        <p className="m-0">{t("receiptsBody", { days: p.receiptDeadlineDays })}</p>
                    </section>
                )}

                {!p.degraded && (
                    <section className={`${paperCard} p-5`}>
                        <SectionHeading title={t("fastTitle")} />
                        <p className="mt-0">
                            {t("fastBody", {
                                paid: p.fastTrackMinPaidRequests,
                                accountDays: p.fastTrackMinAccountDays,
                                level: p.fastTrackMinLevel,
                                fastMax: usd(p.fastTrackMaxUsd),
                            })}
                        </p>
                        <p className="m-0 text-sm text-foreground/70">{t("fastNote")}</p>
                    </section>
                )}

                <section className={`${paperCard} p-5`}>
                    <SectionHeading title={t("howTitle")} />
                    {p.requestFormEnabled ? (
                        <Link href="/payments/new" className={pillInk}>
                            {t("howOpen")}
                        </Link>
                    ) : (
                        <p className="m-0">{t("howClosed")}</p>
                    )}
                </section>

                <p className="m-0">
                    <Link href="/manuals" className="underline">
                        {t("manualsLink")}
                    </Link>
                </p>
            </div>
        </EditorialPage>
    );
}
