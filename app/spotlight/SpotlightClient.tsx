"use client";

// app/spotlight/SpotlightClient.tsx
//
// Nomination form + "your submissions" list for /spotlight (blackolive-55617).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { MemberSubmission } from "@/app/lib/spotlight";
import {
    CITY_MAX_LEN,
    LINK_MAX_LEN,
    MAX_LINKS,
    NAME_MAX_LEN,
    PITCH_MAX_LEN,
    type SpotlightStatus,
} from "@/app/lib/spotlight-shared";

const cardStyle: React.CSSProperties = {
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    borderColor: "hsl(var(--rule-warm) / 0.55)",
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid hsl(var(--rule-warm) / 0.55)",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    font: "inherit",
};

const FIELD_ERRORS = ["pitch", "nomineeName", "links", "consent", "photoUrl"] as const;

function StatusPill({ status, label }: { status: SpotlightStatus; label: string }) {
    const color =
        status === "FEATURED"
            ? "hsl(var(--tomato))"
            : status === "SHORTLISTED"
              ? "hsl(var(--ink) / 0.75)"
              : "hsl(var(--ink) / 0.45)";
    return (
        <span
            className="overline"
            style={{ border: `1px solid ${color}`, color, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}
        >
            {label}
        </span>
    );
}

export function SpotlightClient() {
    const t = useTranslations("spotlight");
    const locale = useLocale();
    const [items, setItems] = useState<MemberSubmission[] | null>(null);
    const [isSelf, setIsSelf] = useState(true);
    const [nomineeName, setNomineeName] = useState("");
    const [nomineeDiscord, setNomineeDiscord] = useState("");
    const [city, setCity] = useState("");
    const [pitch, setPitch] = useState("");
    const [links, setLinks] = useState<string[]>([""]);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/spotlight/submissions", { cache: "no-store" });
            if (!res.ok) throw new Error();
            const json = await res.json();
            setItems(json.submissions ?? []);
        } catch {
            setItems([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const reset = () => {
        setNomineeName("");
        setNomineeDiscord("");
        setCity("");
        setPitch("");
        setLinks([""]);
        setPhotoUrl(null);
        setConsent(false);
        setError(null);
    };

    const errorFor = (status: number, json: { error?: string; field?: string }) => {
        if (status === 429) return t("errors.tooMany");
        if (json.field && (FIELD_ERRORS as readonly string[]).includes(json.field)) {
            return t(`errors.${json.field as (typeof FIELD_ERRORS)[number]}`);
        }
        return t("errors.generic");
    };

    const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setError(null);
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/spotlight/upload", { method: "POST", body: fd });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || typeof json?.url !== "string") {
                setError(t("errors.uploadFailed"));
                return;
            }
            setPhotoUrl(json.url);
        } catch {
            setError(t("errors.uploadFailed"));
        } finally {
            setUploading(false);
        }
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await fetch("/api/spotlight/submissions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    isSelf,
                    nomineeName: isSelf ? undefined : nomineeName,
                    nomineeDiscord: isSelf ? undefined : nomineeDiscord,
                    city,
                    pitch,
                    links: links.filter((l) => l.trim()),
                    photoUrl,
                    consent,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(errorFor(res.status, json));
                return;
            }
            reset();
            setDone(true);
            await load();
        } catch {
            setError(t("errors.network"));
        } finally {
            setBusy(false);
        }
    };

    const canSubmit =
        !busy &&
        !uploading &&
        pitch.trim().length > 0 &&
        pitch.length <= PITCH_MAX_LEN &&
        consent &&
        (isSelf || nomineeName.trim().length > 0);

    const modeBtn = (active: boolean): React.CSSProperties => ({
        background: active ? "hsl(var(--ink))" : "transparent",
        color: active ? "hsl(var(--cream))" : "hsl(var(--foreground))",
        border: "1px solid hsl(var(--ink))",
    });

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10 grid gap-6 fade-up">
                <header>
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1
                        className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] m-0"
                        style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1 }}
                    >
                        {t("title")}
                    </h1>
                    <p className="m-0 mt-2 text-foreground/70">{t("intro")}</p>
                </header>

                {done ? (
                    <div className="paper-soft grid gap-4 rounded-[24px] border p-5 sm:p-6" style={cardStyle}>
                        <p role="status" className="m-0">
                            {t("success")}
                        </p>
                        <button
                            type="button"
                            className="btn-pill self-start"
                            style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}
                            onClick={() => setDone(false)}
                        >
                            {t("submitAnother")}
                        </button>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="paper-soft grid gap-4 rounded-[24px] border p-5 sm:p-6" style={cardStyle}>
                        <div className="flex gap-2 flex-wrap" role="group">
                            <button type="button" aria-pressed={isSelf} className="btn-pill" style={modeBtn(isSelf)} onClick={() => setIsSelf(true)}>
                                {t("modeSelf")}
                            </button>
                            <button type="button" aria-pressed={!isSelf} className="btn-pill" style={modeBtn(!isSelf)} onClick={() => setIsSelf(false)}>
                                {t("modeOther")}
                            </button>
                        </div>

                        {!isSelf ? (
                            <>
                                <label className="grid gap-1">
                                    <span className="text-sm font-semibold">{t("nomineeName")}</span>
                                    <input
                                        value={nomineeName}
                                        onChange={(e) => setNomineeName(e.target.value)}
                                        maxLength={NAME_MAX_LEN}
                                        required
                                        style={inputStyle}
                                    />
                                </label>
                                <label className="grid gap-1">
                                    <span className="text-sm font-semibold">{t("nomineeDiscord")}</span>
                                    <input
                                        value={nomineeDiscord}
                                        onChange={(e) => setNomineeDiscord(e.target.value)}
                                        maxLength={NAME_MAX_LEN}
                                        style={inputStyle}
                                    />
                                </label>
                            </>
                        ) : null}

                        <label className="grid gap-1">
                            <span className="text-sm font-semibold">{t("city")}</span>
                            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={CITY_MAX_LEN} style={inputStyle} />
                        </label>

                        <label className="grid gap-1">
                            <span className="text-sm font-semibold">{t("pitch")}</span>
                            <textarea
                                value={pitch}
                                onChange={(e) => setPitch(e.target.value)}
                                maxLength={PITCH_MAX_LEN}
                                rows={6}
                                placeholder={t("pitchHint")}
                                required
                                style={{ ...inputStyle, resize: "vertical" }}
                            />
                            <span className="text-xs text-foreground/50">{t("pitchCount", { count: pitch.length, max: PITCH_MAX_LEN })}</span>
                        </label>

                        <fieldset className="grid gap-2 border-0 p-0 m-0">
                            <legend className="text-sm font-semibold mb-1">{t("links", { max: MAX_LINKS })}</legend>
                            {links.map((l, i) => (
                                <input
                                    key={i}
                                    type="url"
                                    aria-label={`${t("links", { max: MAX_LINKS })} ${i + 1}`}
                                    value={l}
                                    onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                                    maxLength={LINK_MAX_LEN}
                                    placeholder={t("linkPlaceholder")}
                                    style={inputStyle}
                                />
                            ))}
                            {links.length < MAX_LINKS ? (
                                <button type="button" className="btn-pill self-start" style={{ border: "1px solid hsl(var(--ink))" }} onClick={() => setLinks((p) => [...p, ""])}>
                                    {t("addLink")}
                                </button>
                            ) : null}
                        </fieldset>

                        <div className="grid gap-1">
                            <label htmlFor="spotlight-photo" className="text-sm font-semibold">
                                {t("photo")}
                            </label>
                            <input id="spotlight-photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPhoto} disabled={uploading} />
                            <span className="text-xs text-foreground/50">{t("photoHint")}</span>
                            {photoUrl ? (
                                <div className="flex items-center gap-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={photoUrl} alt="" width={64} height={64} style={{ objectFit: "cover", borderRadius: 12, width: 64, height: 64 }} />
                                    <button type="button" className="underline text-sm" onClick={() => setPhotoUrl(null)}>
                                        {t("removePhoto")}
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                            <span>{isSelf ? t("consentSelf") : t("consentOther")}</span>
                        </label>

                        {error ? (
                            <p role="alert" className="m-0 text-sm" style={{ color: "hsl(var(--destructive))" }}>
                                {error}
                            </p>
                        ) : null}
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="btn-pill self-start"
                            style={{
                                background: "hsl(var(--ink))",
                                color: "hsl(var(--cream))",
                                opacity: canSubmit ? 1 : 0.5,
                                cursor: canSubmit ? "pointer" : "not-allowed",
                            }}
                        >
                            {busy ? t("submitting") : t("submit")}
                        </button>
                    </form>
                )}

                <section className="grid gap-3">
                    <h2 className="m-0 text-xl font-bold">{t("mine")}</h2>
                    {items === null ? (
                        <p className="m-0 text-foreground/60">{t("loading")}</p>
                    ) : items.length === 0 ? (
                        <p className="m-0 text-foreground/60">{t("empty")}</p>
                    ) : (
                        <ul className="m-0 p-0 list-none grid gap-3">
                            {items.map((s) => (
                                <li key={s.id} className="rounded-[18px] border p-4 grid gap-2" style={cardStyle}>
                                    <div className="flex items-start justify-between gap-3">
                                        <strong className="break-words">{s.nomineeName}</strong>
                                        <StatusPill status={s.status} label={t(`status.${s.status}`)} />
                                    </div>
                                    <p className="m-0 text-sm text-foreground/75 whitespace-pre-wrap break-words">{s.pitch}</p>
                                    <p className="m-0 text-xs text-foreground/50">
                                        {new Date(s.createdAt).toLocaleDateString(locale)}
                                        {s.featuredOn ? ` · ${t("featuredOn", { date: new Date(s.featuredOn).toLocaleDateString(locale, { timeZone: "UTC" }) })}` : ""}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </main>
    );
}
