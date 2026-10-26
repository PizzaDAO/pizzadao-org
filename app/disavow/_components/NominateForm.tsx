"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { paperCard, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

const REASONS = ["SCAM", "THEFT_OF_FUNDS", "NON_DELIVERY", "IMPERSONATION", "HARASSMENT", "OTHER"] as const;
const field = "w-full rounded-[--radius] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2 text-base";

export function NominateForm() {
    const t = useTranslations("disavow.form");
    const tr = useTranslations("disavow.reasons");
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Array<{ memberId: string; name: string }>>([]);
    const [picked, setPicked] = useState<{ memberId: string; name: string } | null>(null);
    const [name, setName] = useState("");
    const [xHandle, setX] = useState("");
    const [discordId, setDiscord] = useState("");
    const [wallet, setWallet] = useState("");
    const [telegram, setTelegram] = useState("");
    const [reason, setReason] = useState<(typeof REASONS)[number]>("SCAM");
    const [statement, setStatement] = useState("");
    const [evidence, setEvidence] = useState("");
    const [attest, setAttest] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [existingId, setExistingId] = useState<string | null>(null);

    async function search(q: string) {
        setQuery(q);
        if (q.trim().length < 2) return setResults([]);
        try {
            const res = await fetch(`/api/referrals/inviters?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            setResults(data.members ?? []);
        } catch {
            setResults([]);
        }
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setExistingId(null);
        const identifiers: Array<{ kind: string; value: string }> = [];
        if (picked) identifiers.push({ kind: "MEMBER_ID", value: picked.memberId });
        if (xHandle.trim()) identifiers.push({ kind: "X_HANDLE", value: xHandle });
        if (discordId.trim()) identifiers.push({ kind: "DISCORD_ID", value: discordId });
        if (wallet.trim()) identifiers.push({ kind: "WALLET", value: wallet });
        if (telegram.trim()) identifiers.push({ kind: "TELEGRAM", value: telegram });
        try {
            const res = await fetch("/api/disavow", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    displayName: name || picked?.name || "",
                    reason,
                    statement,
                    evidenceUrls: evidence.split("\n").map((s) => s.trim()).filter(Boolean),
                    identifiers,
                    attest,
                }),
            });
            const data = await res.json().catch(() => ({}));
            // Same landing for every outcome, so a duplicate of a hidden entry looks like any accepted nomination.
            if (res.status === 201) return router.push(data.id ? `/disavow/${data.id}` : "/disavow");
            if (res.status === 409) {
                setExistingId(data.existingId ?? null);
                setError(t("errorDuplicate"));
            } else if (res.status === 429) {
                setError(data.code === "LIMIT" ? t("errorLimit") : t("errorRate"));
            } else if (data.error === "You cannot nominate yourself") {
                setError(t("errorSelf"));
            } else {
                setError(t("errorGeneric"));
            }
        } catch {
            setError(t("errorGeneric"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} className={`${paperCard} grid gap-5 p-5`}>
            <div className="grid gap-2">
                <label htmlFor="dv-search" className="font-semibold">{t("search")}</label>
                <input id="dv-search" className={field} value={query} placeholder={t("searchPlaceholder")} onChange={(e) => search(e.target.value)} autoComplete="off" />
                <p className="m-0 text-sm text-foreground/70">{t("searchHelp")}</p>
                {picked ? (
                    <p className="m-0 flex items-center gap-3 text-sm">
                        {t("picked", { name: picked.name })}
                        <button type="button" className={pillOutline} onClick={() => setPicked(null)}>{t("clear")}</button>
                    </p>
                ) : (
                    results.length > 0 && (
                        <ul className="m-0 grid list-none gap-1 p-0">
                            {results.map((m) => (
                                <li key={m.memberId}>
                                    <button type="button" className="min-h-11 w-full cursor-pointer rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] bg-card px-3 text-left"
                                        onClick={() => { setPicked(m); setName(m.name); setResults([]); setQuery(""); }}>
                                        {m.name} · #{m.memberId}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )
                )}
            </div>

            <div className="grid gap-2">
                <label htmlFor="dv-name" className="font-semibold">{t("name")}</label>
                <input id="dv-name" required maxLength={120} className={field} value={name} onChange={(e) => setName(e.target.value)} />
                <p className="m-0 text-sm text-foreground/70">{t("nameHelp")}</p>
            </div>

            {([
                ["dv-x", t("xHandle"), xHandle, setX],
                ["dv-discord", t("discordId"), discordId, setDiscord],
                ["dv-wallet", t("wallet"), wallet, setWallet],
                ["dv-telegram", t("telegram"), telegram, setTelegram],
            ] as const).map(([id, label, value, set]) => (
                <div key={id} className="grid gap-2">
                    <label htmlFor={id} className="font-semibold">{label}</label>
                    <input id={id} className={field} value={value} onChange={(e) => set(e.target.value)} autoComplete="off" />
                </div>
            ))}

            <div className="grid gap-2">
                <label htmlFor="dv-reason" className="font-semibold">{t("reason")}</label>
                <select id="dv-reason" className={field} value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                    {REASONS.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
                </select>
            </div>

            <div className="grid gap-2">
                <label htmlFor="dv-statement" className="font-semibold">{t("statement")}</label>
                <textarea id="dv-statement" required minLength={20} maxLength={1500} rows={7} className={field} value={statement} onChange={(e) => setStatement(e.target.value)} />
                <p className="m-0 text-sm text-foreground/70">{t("statementHelp")}</p>
            </div>

            <div className="grid gap-2">
                <label htmlFor="dv-evidence" className="font-semibold">{t("evidence")}</label>
                <textarea id="dv-evidence" rows={3} className={field} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                <p className="m-0 text-sm text-foreground/70">{t("evidenceHelp")}</p>
            </div>

            <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" required checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 h-5 w-5" />
                <span>{t("attest")}</span>
            </label>

            {error && (
                <p role="alert" className="m-0 text-sm font-semibold text-tomato-readable">
                    {error}{" "}
                    {existingId && <Link href={`/disavow/${existingId}`} className="underline">{t("viewExisting")}</Link>}
                </p>
            )}

            <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={busy || !attest} className={`${pillTomato} cursor-pointer disabled:opacity-60`}>
                    {busy ? t("submitting") : t("submit")}
                </button>
                <Link href="/disavow" className={pillOutline}>{t("cancel")}</Link>
            </div>
        </form>
    );
}
