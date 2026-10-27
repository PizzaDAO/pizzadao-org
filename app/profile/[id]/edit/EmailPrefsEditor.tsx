"use client";

// Weekly digest sign-up on the profile edit page: an email field, an explicit
// opt-in, and the verification state. Reads/writes /api/email-prefs
// (session-scoped; the server resolves the member). The address is stored in
// the app database, never in the public Crew sheet.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Prefs = { email: string | null; verified: boolean; optIn: boolean };

export function EmailPrefsEditor() {
    const t = useTranslations("reengage.prefs");
    const [prefs, setPrefs] = useState<Prefs | null>(null);
    const [email, setEmail] = useState("");
    const [optIn, setOptIn] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);

    function apply(p: Prefs) {
        setPrefs(p);
        setEmail(p.email ?? "");
        setOptIn(p.optIn);
    }

    useEffect(() => {
        let alive = true;
        fetch("/api/email-prefs")
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!alive) return;
                if (j && typeof j.optIn === "boolean") apply(j);
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
            const res = await fetch("/api/email-prefs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => null);
            if (res.status === 400 && j?.error === "invalid_email") {
                setError(t("invalidEmail"));
                return;
            }
            if (!res.ok || !j) throw new Error("save failed");
            apply(j);
            if (j.confirmation === "sent") setNote(t("pending"));
            else if (j.confirmation === "too_soon") setNote(t("tooSoon"));
            else if (j.confirmation === "too_many") setNote(t("tooMany"));
            else if (j.confirmation === "failed") setError(t("sendFailed"));
            else if (j.optIn && j.email && !j.verified) setNote(t("pending"));
            else setNote(t("saved"));
        } catch {
            setError(t("saveError"));
        } finally {
            setBusy(false);
        }
    }

    const loaded = prefs !== null;
    return (
        <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
                e.preventDefault();
                const addr = email.trim();
                // An empty field removes the address (and opts out).
                void submit(addr ? { email: addr, optIn } : { email: null });
            }}
        >
            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                {t("emailLabel")}
                <input
                    type="email"
                    value={email}
                    maxLength={254}
                    autoComplete="email"
                    disabled={busy || !loaded}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ padding: "8px 10px", border: "1px solid hsl(var(--ink) / 0.25)", borderRadius: 8 }}
                />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
                <input
                    type="checkbox"
                    checked={optIn}
                    disabled={busy || !loaded}
                    onChange={(e) => setOptIn(e.target.checked)}
                />
                {t("optIn")}
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <button type="submit" disabled={busy || !loaded} className="btn-pill">
                    {t("save")}
                </button>
                {prefs?.email && prefs.verified ? (
                    <span style={{ fontSize: 13 }}>{t("verified")}</span>
                ) : null}
                {prefs?.email && !prefs.verified && prefs.optIn ? (
                    <button type="button" disabled={busy} onClick={() => void submit({ resend: true })} style={{ fontSize: 13, textDecoration: "underline" }}>
                        {t("resend")}
                    </button>
                ) : null}
            </div>
            {loadError ? (
                <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
                    {t("loadError")}
                </div>
            ) : null}
            {note ? <div role="status" style={{ fontSize: 13 }}>{note}</div> : null}
            {error ? (
                <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
                    {error}
                </div>
            ) : null}
        </form>
    );
}
