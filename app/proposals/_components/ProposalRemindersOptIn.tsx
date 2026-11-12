"use client";

// One-tap opt-in on /proposals: "DM me when a proposal opens or is about to close". Opt-in only; the same
// preference as the profile page (/api/reminder-prefs, session-scoped). Shown to members who can vote.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function ProposalRemindersOptIn() {
    const t = useTranslations("reminders.prefs");
    const [on, setOn] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch("/api/reminder-prefs")
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (alive && j && typeof j.proposals === "boolean") setOn(j.proposals);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    async function toggle(next: boolean) {
        setBusy(true);
        setError(false);
        try {
            const res = await fetch("/api/reminder-prefs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proposals: next }),
            });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j || typeof j.proposals !== "boolean") throw new Error("save failed");
            setOn(j.proposals);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }

    // Until the preference has loaded there is nothing honest to show.
    if (on === null) return null;
    return (
        <div className="mb-6 grid gap-1 text-sm">
            <label className="flex items-start gap-2">
                <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
                <span>{t("proposals")}</span>
            </label>
            <span className="pl-6 text-foreground/60">{t("proposalsHint")}</span>
            {error ? (
                <span role="alert" className="pl-6 text-destructive">
                    {t("saveError")}
                </span>
            ) : null}
        </div>
    );
}
