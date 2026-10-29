"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EditorialMasthead, paperCard } from "@/app/ui/shared/Editorial";

const KINDS = ["EVENT_BUDGET", "REIMBURSEMENT", "WORK", "OTHER"] as const;
const field = "w-full min-h-11 px-3 text-base rounded border bg-card";

export function NewPaymentForm() {
    const t = useTranslations("payments");
    const [kind, setKind] = useState<string>("EVENT_BUDGET");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [amount, setAmount] = useState("");
    const [eventDate, setEventDate] = useState("");
    const [eventCity, setEventCity] = useState("");
    const [proposalUrl, setProposalUrl] = useState("");
    const [payee, setPayee] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            const r = await fetch("/api/payments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, title, description, amount, eventDate, eventCity, proposalUrl, payee }),
            });
            const body = await r.json().catch(() => ({}));
            if (r.ok) {
                setDone(true);
                return;
            }
            const code = r.status === 403 ? "closed" : typeof body.error === "string" && t.has(`errors.${body.error}` as never) ? body.error : "generic";
            setError(t(`errors.${code}` as never));
        } catch {
            setError(t("errors.generic"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <EditorialMasthead overline={t("overline")} title={t("formTitle")} dek={t("formDek")} />
            {done ? (
                <div className="grid gap-3">
                    <p role="status">{t("sent")}</p>
                    <Link href="/payments" className="underline">
                        {t("backToList")}
                    </Link>
                </div>
            ) : (
                <form onSubmit={submit} className={`${paperCard} p-5 grid gap-4`}>
                    <p className="m-0 text-sm text-foreground/70">{t("partyNote")}</p>
                    <label className="grid gap-1">
                        {t("fieldKind")}
                        <select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
                            {KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {t(`kind.${k}` as never)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="grid gap-1">
                        {t("fieldTitle")}
                        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldDescription")}
                        <textarea className={`${field} min-h-28 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} required />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldAmount")}
                        <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-1">
                            {t("fieldEventDate")}
                            <input className={field} type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                        </label>
                        <label className="grid gap-1">
                            {t("fieldEventCity")}
                            <input className={field} value={eventCity} onChange={(e) => setEventCity(e.target.value)} maxLength={100} />
                        </label>
                    </div>
                    <label className="grid gap-1">
                        {t("fieldProposal")}
                        <input className={field} type="url" inputMode="url" value={proposalUrl} onChange={(e) => setProposalUrl(e.target.value)} maxLength={500} />
                    </label>
                    <label className="grid gap-1">
                        {t("fieldPayee")}
                        <input className={field} value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} autoComplete="off" />
                        <span className="text-sm text-foreground/70">{t("payeeHelp")}</span>
                    </label>
                    {error && (
                        <p role="alert" className="m-0 text-tomato">
                            {error}
                        </p>
                    )}
                    <button type="submit" disabled={busy} className="min-h-11 px-5 rounded bg-foreground text-background w-fit disabled:opacity-50">
                        {busy ? t("submitting") : t("submit")}
                    </button>
                </form>
            )}
        </>
    );
}
