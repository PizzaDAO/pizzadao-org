"use client";

// Weekly re-engagement email toggle on the profile edit page.
// Reads/writes /api/email-prefs (session-scoped; the server resolves the member).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function EmailPrefsEditor() {
    const t = useTranslations("reengage.prefs");
    const [weekly, setWeekly] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        fetch("/api/email-prefs")
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (alive && j && typeof j.weekly === "boolean") setWeekly(j.weekly);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    async function toggle(next: boolean) {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/email-prefs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weekly: next }),
            });
            if (!res.ok) throw new Error("save failed");
            setWeekly(next);
        } catch {
            setError(t("saveError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
                <input
                    type="checkbox"
                    checked={weekly ?? true}
                    disabled={busy || weekly === null}
                    onChange={(e) => toggle(e.target.checked)}
                />
                {t("label")}
            </label>
            {error ? (
                <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
                    {error}
                </div>
            ) : null}
        </div>
    );
}
