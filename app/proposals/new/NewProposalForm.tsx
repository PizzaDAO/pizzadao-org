"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { EditorialMasthead, paperCard } from "@/app/ui/shared/Editorial";

const field = "w-full min-h-11 px-3 text-base rounded border bg-card";

export type Tiers = { capUsd: number; midMaxUsd: number; low: number; mid: number; high: number; general: number };

/** Ayes plus abstains a proposal needs today (the same tiers the server copies onto it when it opens). */
function ayesFor(kind: "FUNDING" | "GENERAL", amountUsd: number, tiers: Tiers): number {
    if (kind === "GENERAL" || !(amountUsd > 0)) return kind === "GENERAL" ? tiers.general : tiers.low;
    if (amountUsd <= tiers.capUsd) return tiers.low;
    return amountUsd <= tiers.midMaxUsd ? tiers.mid : tiers.high;
}

type Found = { name: string; discordId: string };

export function NewProposalForm({ tiers = null, pilot = null }: { tiers?: Tiers | null; pilot?: { minutes: number } | null }) {
    const t = useTranslations("proposals.form");
    const tp = useTranslations("proposals");
    const [kind, setKind] = useState<"FUNDING" | "GENERAL">("FUNDING");
    const [v, setV] = useState({ title: "", amount: "", eventDate: "", city: "", sponsor: "", attendance: "", otherSponsors: "", pizzaFrom: "", description: "", budget: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [doneId, setDoneId] = useState("");
    // Optional beneficiary: the member who will file the payment requests when the proposal passes.
    const [who, setWho] = useState("");
    const [found, setFound] = useState<Found[]>([]);
    const [beneficiary, setBeneficiary] = useState<Found | null>(null);
    const amountUsd = Number(v.amount.replace(/[$,\s]/g, ""));

    useEffect(() => {
        const q = who.trim();
        if (q.length < 2) {
            setFound([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            fetch(`/api/proposals/members?q=${encodeURIComponent(q)}`, { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : null))
                .then((b) => {
                    if (!cancelled) setFound(b && Array.isArray(b.members) ? (b.members as Found[]).slice(0, 8) : []);
                })
                .catch(() => {});
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [who]);
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            const r = await fetch("/api/proposals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, ...v, beneficiary: beneficiary?.discordId ?? "" }),
            });
            const body = await r.json().catch(() => ({}));
            if (r.ok && typeof body.id === "string") {
                setDoneId(body.id);
                return;
            }
            const code = typeof body.error === "string" && t.has(`errors.${body.error}` as never) ? body.error : "generic";
            setError(t(`errors.${code}` as never));
        } catch {
            setError(t("errors.generic"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <EditorialMasthead overline={tp("overline")} title={t("title")} dek={t("dek")} />
            {doneId ? (
                <div className="grid gap-3">
                    <p role="status">{t("sent")}</p>
                    <Link href={`/proposals/${doneId}`} className="underline">
                        {t("viewIt")}
                    </Link>
                </div>
            ) : (
                <form onSubmit={submit} className={`${paperCard} grid gap-4 p-5`}>
                    <label className="grid gap-1">
                        {t("fieldKind")}
                        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as "FUNDING" | "GENERAL")}>
                            <option value="FUNDING">{tp("kind.FUNDING")}</option>
                            <option value="GENERAL">{tp("kind.GENERAL")}</option>
                        </select>
                    </label>
                    <label className="grid gap-1">
                        {t("fieldTitle")}
                        <input className={field} value={v.title} onChange={set("title")} maxLength={200} required />
                    </label>
                    {kind === "FUNDING" && (
                        <label className="grid gap-1">
                            {t("fieldAmount")}
                            <input className={field} inputMode="decimal" value={v.amount} onChange={set("amount")} required />
                        </label>
                    )}
                    {pilot && (
                        <p className="m-0 rounded border p-3 text-sm" role="note">
                            {t("pilotNeeds", { minutes: pilot.minutes })}
                        </p>
                    )}
                    {!pilot && tiers && (
                        <p className="m-0 rounded border p-3 text-sm" role="note">
                            {t("tierNeeds", { count: ayesFor(kind, amountUsd, tiers) })}{" "}
                            {kind === "FUNDING" ? t("tierList", { cap: tiers.capUsd, low: tiers.low, mid: tiers.mid, midMax: tiers.midMaxUsd, high: tiers.high }) : ""}{" "}
                            {t("tierNote")}
                        </p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-1">
                            {t("fieldDate")}
                            <input className={field} type="date" value={v.eventDate} onChange={set("eventDate")} />
                        </label>
                        <label className="grid gap-1">
                            {t("fieldCity")}
                            <input className={field} value={v.city} onChange={set("city")} maxLength={100} />
                        </label>
                    </div>
                    <label className="grid gap-1">
                        {t("fieldSponsor")}
                        <input className={field} value={v.sponsor} onChange={set("sponsor")} maxLength={120} />
                        <span className="text-sm text-foreground/70">{t("sponsorHelp")}</span>
                    </label>
                    <div className="grid gap-1">
                        <label htmlFor="beneficiary-search">{t("fieldBeneficiary")}</label>
                        {beneficiary ? (
                            <p className="m-0 flex flex-wrap items-center gap-2">
                                <strong>{beneficiary.name}</strong>
                                <button type="button" className="min-h-11 rounded border px-3" onClick={() => setBeneficiary(null)}>
                                    {t("beneficiaryClear")}
                                </button>
                            </p>
                        ) : (
                            <>
                                <input id="beneficiary-search" className={field} value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} autoComplete="off" placeholder={t("beneficiarySearch")} />
                                {found.length > 0 && (
                                    <ul className="m-0 grid list-none gap-1 p-0">
                                        {found.map((m) => (
                                            <li key={m.discordId}>
                                                <button
                                                    type="button"
                                                    className="min-h-11 w-full rounded border bg-card px-3 text-left"
                                                    onClick={() => {
                                                        setBeneficiary(m);
                                                        setWho("");
                                                        setFound([]);
                                                    }}
                                                >
                                                    {m.name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                        <span className="text-sm text-foreground/70">{t("beneficiaryHelp")}</span>
                    </div>
                    <label className="grid gap-1">
                        {t("fieldAttendance")}
                        <input className={field} value={v.attendance} onChange={set("attendance")} maxLength={60} />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldOtherSponsors")}
                        <input className={field} value={v.otherSponsors} onChange={set("otherSponsors")} maxLength={400} />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldPizzaFrom")}
                        <input className={field} value={v.pizzaFrom} onChange={set("pizzaFrom")} maxLength={200} />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldDescription")}
                        <textarea className={`${field} min-h-32 py-2`} value={v.description} onChange={set("description")} maxLength={6000} required />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldBudget")}
                        <textarea className={`${field} min-h-24 py-2`} value={v.budget} onChange={set("budget")} maxLength={3000} />
                    </label>
                    {error && (
                        <p role="alert" className="m-0 text-tomato">
                            {error}
                        </p>
                    )}
                    <button type="submit" disabled={busy} className="min-h-11 w-fit rounded bg-foreground px-5 text-background disabled:opacity-50">
                        {busy ? t("submitting") : t("submit")}
                    </button>
                </form>
            )}
        </>
    );
}
