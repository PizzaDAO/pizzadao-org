"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EditorialMasthead, paperCard } from "@/app/ui/shared/Editorial";

const field = "w-full min-h-11 px-3 text-base rounded border bg-card";

export function NewProposalForm() {
    const t = useTranslations("proposals.form");
    const tp = useTranslations("proposals");
    const [kind, setKind] = useState<"FUNDING" | "GENERAL">("FUNDING");
    const [v, setV] = useState({ title: "", amount: "", eventDate: "", city: "", sponsor: "", attendance: "", otherSponsors: "", pizzaFrom: "", description: "", budget: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [doneId, setDoneId] = useState("");
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            const r = await fetch("/api/proposals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, ...v }),
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
