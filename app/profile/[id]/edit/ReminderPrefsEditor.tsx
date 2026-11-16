"use client";

// Call reminders by DM on the profile edit page: off, the Community Call, or the Community Call plus the
// member's crews and Discord events they marked Interested; how early (5 to 60 minutes) and where (Discord,
// Telegram or both). Opt-in only (no row means no reminders). Reads/writes /api/reminder-prefs
// (session-scoped; the server resolves the member).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Choice = "NONE" | "COMMUNITY" | "MY_CREWS";
type Where = "DISCORD" | "TELEGRAM" | "BOTH";
type Prefs = { calls: Choice; leadMinutes?: number | null; channel?: Where; telegramLinked?: boolean; proposals?: boolean; dmClosed: boolean };

const LEADS = [5, 10, 15, 30, 60];
const WHERES: Array<{ value: Where; key: "channelDiscord" | "channelTelegram" | "channelBoth" }> = [
    { value: "DISCORD", key: "channelDiscord" },
    { value: "TELEGRAM", key: "channelTelegram" },
    { value: "BOTH", key: "channelBoth" },
];

const CHOICES: Array<{ value: Choice; key: "none" | "community" | "myCrews" }> = [
    { value: "NONE", key: "none" },
    { value: "COMMUNITY", key: "community" },
    { value: "MY_CREWS", key: "myCrews" },
];

export function ReminderPrefsEditor() {
    const t = useTranslations("reminders.prefs");
    const [prefs, setPrefs] = useState<Prefs | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch("/api/reminder-prefs")
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!alive) return;
                if (j && typeof j.calls === "string") setPrefs(j);
                else setLoadError(true);
            })
            .catch(() => {
                if (alive) setLoadError(true);
            });
        return () => {
            alive = false;
        };
    }, []);

    async function submit(payload: Record<string, unknown>) {
        setBusy(true);
        setError(null);
        setNote(null);
        try {
            const res = await fetch("/api/reminder-prefs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j || typeof j.calls !== "string") throw new Error("save failed");
            setPrefs(j);
            setNote(t("saved"));
        } catch {
            setError(t("saveError"));
        } finally {
            setBusy(false);
        }
    }

    const loaded = prefs !== null;
    return (
        <fieldset style={{ display: "grid", gap: 10, border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 14, marginBottom: 6 }}>{t("legend")}</legend>
            {CHOICES.map((c) => (
                <label key={c.value} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
                    <input
                        type="radio"
                        name="call-reminders"
                        value={c.value}
                        checked={prefs?.calls === c.value}
                        disabled={busy || !loaded}
                        onChange={() => void submit({ calls: c.value })}
                    />
                    {t(c.key)}
                </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, marginTop: 6 }}>
                {t("leadLegend")}
                <select
                    value={prefs?.leadMinutes ?? ""}
                    disabled={busy || !loaded}
                    onChange={(e) => void submit({ leadMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                    style={{ fontSize: 15 }}
                >
                    <option value="">{t("leadDefault")}</option>
                    {LEADS.map((m) => (
                        <option key={m} value={m}>
                            {t("leadOption", { minutes: m })}
                        </option>
                    ))}
                </select>
            </label>
            <div role="radiogroup" aria-label={t("channelLegend")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, fontSize: 15 }}>
                <span>{t("channelLegend")}</span>
                {WHERES.map((w) => {
                    const needsLink = w.value !== "DISCORD" && !prefs?.telegramLinked;
                    return (
                        <label key={w.value} style={{ display: "flex", alignItems: "center", gap: 6, opacity: needsLink ? 0.5 : 1 }}>
                            <input
                                type="radio"
                                name="call-reminder-channel"
                                value={w.value}
                                checked={(prefs?.channel ?? "DISCORD") === w.value}
                                disabled={busy || !loaded || needsLink}
                                onChange={() => void submit({ channel: w.value })}
                            />
                            {t(w.key)}
                        </label>
                    );
                })}
            </div>
            {loaded && !prefs?.telegramLinked ? <div style={{ fontSize: 13, opacity: 0.7 }}>{t("telegramNeedsLink")}</div> : null}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, marginTop: 6 }}>
                <input
                    type="checkbox"
                    checked={!!prefs?.proposals}
                    disabled={busy || !loaded}
                    onChange={(e) => void submit({ proposals: e.target.checked })}
                />
                <span>
                    {t("proposals")}
                    <span style={{ display: "block", fontSize: 13, opacity: 0.7 }}>{t("proposalsHint")}</span>
                </span>
            </label>
            {prefs?.dmClosed && (prefs.calls !== "NONE" || prefs.proposals) ? (
                <div role="status" style={{ fontSize: 13, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span>{t("dmClosed")}</span>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submit({ retryDm: true })}
                        style={{ fontSize: 13, textDecoration: "underline" }}
                    >
                        {t("tryAgain")}
                    </button>
                </div>
            ) : null}
            {loadError ? (
                <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
                    {t("loadError")}
                </div>
            ) : null}
            {note ? (
                <div role="status" style={{ fontSize: 13 }}>
                    {note}
                </div>
            ) : null}
            {error ? (
                <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
                    {error}
                </div>
            ) : null}
        </fieldset>
    );
}
