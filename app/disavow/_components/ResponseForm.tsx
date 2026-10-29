"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";

export function ResponseForm({ entryId, initial, hasOpenRound, appealDays }: { entryId: string; initial: string; hasOpenRound: boolean; appealDays: number }) {
    const t = useTranslations("disavow.response");
    const router = useRouter();
    const [text, setText] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [appealed, setAppealed] = useState(hasOpenRound);

    async function save(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch("/api/disavow/me/response", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: entryId, text }),
            });
            setMessage(res.ok ? t("saved") : t("error"));
            if (res.ok) router.refresh();
        } catch {
            setMessage(t("error"));
        } finally {
            setBusy(false);
        }
    }

    async function appeal() {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch("/api/disavow/me/appeal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: entryId }),
            });
            if (res.ok) {
                setAppealed(true);
                setMessage(t("appealed"));
            } else {
                setMessage(res.status === 429 ? t("tooSoon", { days: appealDays }) : res.status === 409 ? t("appealOpen") : t("error"));
            }
        } catch {
            setMessage(t("error"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid gap-5">
            <form onSubmit={save} className={`${paperCard} grid gap-3 p-5`}>
                <label htmlFor="dv-response" className="font-semibold">{t("label")}</label>
                <textarea id="dv-response" required maxLength={1500} rows={6} value={text} onChange={(e) => setText(e.target.value)}
                    className="w-full rounded-[--radius] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2 text-base" />
                <p className="m-0 text-sm text-foreground/70">{t("help")}</p>
                <div><button type="submit" disabled={busy} className={`${pillInk} cursor-pointer`}>{t("save")}</button></div>
            </form>
            <div className={`${paperCard} grid gap-3 p-5`}>
                <p className="m-0 text-sm">{t("appealHelp", { days: appealDays })}</p>
                <div><button type="button" disabled={busy || appealed} className={`${pillOutline} cursor-pointer disabled:opacity-60`} onClick={appeal}>{t("appeal")}</button></div>
            </div>
            {message && <p role="status" className="m-0 text-sm font-semibold">{message}</p>}
        </div>
    );
}
