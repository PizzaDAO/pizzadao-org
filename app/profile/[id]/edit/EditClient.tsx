// app/profile/[id]/edit/EditClient.tsx
//
// Client child for /profile/[id]/edit. Owner-only — the parent server
// component already verified ownership and returned 403 for non-owners.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §7 — PR5 (slice-61816).
//
// This file consolidates the editors that previously lived inside the
// dashboard's "Profile Details" collapsible:
//   * Orgs textarea         -> POST /api/update-orgs
//   * Skills textarea       -> POST /api/update-skills
//   * X account connect     -> GET  /api/x/login?memberId=
//   * X account disconnect  -> DELETE /api/x/disconnect
//   * ProfileLinksEditor    -> existing component (self-managed)
//   * SocialAccountLinker   -> existing component (self-managed)
//
// UX improvements over the dashboard's previous inline editors:
//   * Replaces alert() error popups with inline error states.
//   * Uses shared <Field/> with `hint` and `error` props.
//   * Validation: trim + 500-char cap (matches the server route).
//   * Loading spinners on save buttons.
//   * Inline success confirmation (1.5s flash on Save).
//
// onion-47612: editorial dossier framing — paper-soft section cards,
// "§ NN · …" overlines + display-font subheads, handwritten "draft" /
// "live" annotations. Underlying validation, endpoints, hooks, and form
// state are unchanged — strictly a visual restyle.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field } from "../../../ui/onboarding/Field";
import { ProfileLinksEditor } from "../../../ui/profile-links";
import { SocialAccountLinker } from "../../../ui/vouches/SocialAccountLinker";
import { TaglineEditor } from "../../../dashboard/[id]/components/TaglineEditor";
import { useUserData, useXAccount } from "../../../lib/hooks/use-api";
import {
    SUPPORTED_LOCALES,
    type SupportedLocale,
} from "../../../lib/i18n/locales";

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";
const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

const MAX_LEN = 500;

// ---------------------------------------------------------------------------
// Editorial section card. paper-soft + halftone over the warm cream
// surface, with the "§ NN · …" overline rendered above an optional
// display-font subhead.
// ---------------------------------------------------------------------------

interface EditorialSectionProps {
    overline: string;
    title: string;
    description?: string;
    children: React.ReactNode;
    /** Optional handwritten margin annotation (e.g. "draft", "live"). */
    annotation?: string;
}

function EditorialSection({
    overline,
    title,
    description,
    children,
    annotation,
}: EditorialSectionProps) {
    return (
        <section
            className="paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6 grid gap-4 fade-up"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <header className="grid gap-1 relative">
                <p className="overline text-tomato">{overline}</p>
                <h2
                    className="font-[family-name:var(--font-display)] m-0 font-bold tracking-[-0.01em] text-foreground"
                    style={{ fontSize: "clamp(1.2rem, 2.4vw, 1.5rem)" }}
                >
                    {title}
                </h2>
                {description && (
                    <p className="m-0 text-foreground/65" style={{ fontSize: 13.5 }}>
                        {description}
                    </p>
                )}
                {annotation && (
                    <span
                        aria-hidden
                        className="handwritten pointer-events-none hidden md:block absolute right-0 top-0 rotate-[-4deg]"
                        style={{
                            color: "hsl(var(--tomato))",
                            fontSize: 18,
                            opacity: 0.7,
                        }}
                    >
                        {annotation}
                    </span>
                )}
            </header>
            <div className="grid gap-3">{children}</div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Button shim — keeps the existing `btn()` signature for inner editors so we
// don't have to change every save button. Now renders to the editorial
// pill vocabulary.
// ---------------------------------------------------------------------------

function btn(kind: "primary" | "secondary"): React.CSSProperties {
    if (kind === "primary") {
        return {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "10px 20px",
            borderRadius: 9999,
            background: "hsl(var(--ink))",
            color: "hsl(var(--cream))",
            border: "1px solid hsl(var(--ink))",
            fontWeight: 600,
            fontFamily: FONT_SANS,
            fontSize: 13.5,
            cursor: "pointer",
            textDecoration: "none",
            textAlign: "center",
            transition:
                "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
        };
    }
    return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 20px",
        borderRadius: 9999,
        background: "hsl(var(--cream))",
        color: "hsl(var(--ink))",
        border: "1px solid hsl(var(--rule-warm) / 0.55)",
        fontWeight: 600,
        fontFamily: FONT_SANS,
        fontSize: 13.5,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        transition:
            "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    };
}

function Spinner({ size = 12 }: { size?: number }) {
    return (
        <span
            aria-hidden
            style={{
                display: "inline-block",
                width: size,
                height: size,
                border: "2px solid hsl(var(--cream) / 0.35)",
                borderTopColor: "hsl(var(--cream))",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// Text editor (orgs / skills). Submits via POST to the given API endpoint.
// ---------------------------------------------------------------------------

interface TextEditorProps {
    label: string;
    hint: string;
    initial: string;
    endpoint: string;
    memberId: string;
    fieldKey: "orgs" | "skills";
    placeholder: string;
}

function TextEditor({
    label,
    hint,
    initial,
    endpoint,
    memberId,
    fieldKey,
    placeholder,
}: TextEditorProps) {
    const [value, setValue] = useState(initial === "None" ? "" : initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        setValue(initial === "None" ? "" : initial);
    }, [initial]);

    const trimmed = value.trim();
    const tooLong = trimmed.length > MAX_LEN;
    const dirty = trimmed !== (initial === "None" ? "" : initial).trim();

    const onSave = async () => {
        setError(null);
        if (tooLong) {
            setError(`Too long — keep under ${MAX_LEN} characters.`);
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    memberId,
                    [fieldKey]: trimmed,
                }),
            });
            if (!res.ok) {
                let msg = `Failed to save (${res.status})`;
                try {
                    const body = await res.json();
                    if (body?.error) msg = String(body.error);
                } catch {
                    /* swallow */
                }
                setError(msg);
                return;
            }
            setSavedAt(Date.now());
        } catch (e) {
            setError(
                e instanceof Error ? e.message : "Network error — please try again."
            );
        } finally {
            setSaving(false);
        }
    };

    // Hide the "Saved" flash after 1.5s.
    useEffect(() => {
        if (savedAt == null) return;
        const t = setTimeout(() => setSavedAt(null), 1500);
        return () => clearTimeout(t);
    }, [savedAt]);

    return (
        <Field
            label={label}
            hint={!error ? `${hint} · ${trimmed.length}/${MAX_LEN}` : undefined}
            error={error || (tooLong ? `Too long — max ${MAX_LEN} characters.` : undefined)}
        >
            <div style={{ display: "grid", gap: 8 }}>
                <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    style={{
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid hsl(var(--rule-warm) / 0.55)",
                        background: "hsl(var(--cream) / 0.4)",
                        color: "hsl(var(--foreground))",
                        fontSize: 14,
                        fontFamily: FONT_SANS,
                        resize: "vertical",
                        minHeight: 72,
                    }}
                />
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving || tooLong || !dirty}
                        style={{
                            ...btn("primary"),
                            opacity: saving || tooLong || !dirty ? 0.5 : 1,
                            cursor:
                                saving || tooLong || !dirty ? "not-allowed" : "pointer",
                        }}
                    >
                        {saving ? <Spinner /> : null}
                        {saving ? "Saving…" : "Save"}
                    </button>
                    {savedAt && !error ? (
                        <span
                            role="status"
                            className="overline"
                            style={{ color: "hsl(var(--ink) / 0.55)" }}
                        >
                            § Saved
                        </span>
                    ) : null}
                </div>
            </div>
        </Field>
    );
}

// ---------------------------------------------------------------------------
// X connect / disconnect.
// ---------------------------------------------------------------------------

function XAccountEditor({ memberId }: { memberId: string }) {
    const { data, refetch } = useXAccount(memberId);
    const [account, setAccount] = useState<
        | { connected: boolean; username?: string; displayName?: string }
        | null
    >(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (data) setAccount(data);
    }, [data]);

    const onDisconnect = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch("/api/x/disconnect", { method: "DELETE" });
            if (!res.ok) {
                let msg = `Failed to disconnect (${res.status})`;
                try {
                    const body = await res.json();
                    if (body?.error) msg = String(body.error);
                } catch {
                    /* swallow */
                }
                setError(msg);
                return;
            }
            setAccount({ connected: false });
            refetch();
        } catch (e) {
            setError(
                e instanceof Error ? e.message : "Network error — please try again."
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            style={{
                padding: 14,
                borderRadius: 16,
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                background: "hsl(var(--cream) / 0.4)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
            }}
        >
            <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ flexShrink: 0 }}
                aria-label="X (Twitter)"
            >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
                {account?.connected ? (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                        }}
                    >
                        <div>
                            <a
                                href={`https://x.com/${account.username}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                    fontWeight: 600,
                                    fontSize: 16,
                                    color: "hsl(var(--foreground))",
                                    textDecoration: "none",
                                }}
                            >
                                @{account.username}
                            </a>
                            <div
                                className="overline"
                                style={{
                                    color: "hsl(var(--ink) / 0.55)",
                                    marginTop: 2,
                                }}
                            >
                                § Connected
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onDisconnect}
                            disabled={busy}
                            style={{
                                ...btn("secondary"),
                                opacity: busy ? 0.5 : 1,
                                cursor: busy ? "not-allowed" : "pointer",
                            }}
                        >
                            {busy ? <Spinner /> : null}
                            {busy ? "Disconnecting…" : "Disconnect"}
                        </button>
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                        }}
                    >
                        <span
                            style={{
                                fontSize: 14,
                                color: "hsl(var(--ink) / 0.7)",
                            }}
                        >
                            Connect your X account
                        </span>
                        <a
                            href={`/api/x/login?memberId=${memberId}`}
                            style={btn("primary")}
                        >
                            Connect X
                        </a>
                    </div>
                )}
            </div>
            {error ? (
                <div
                    style={{
                        flexBasis: "100%",
                        fontSize: 13,
                        color: "hsl(var(--destructive))",
                    }}
                >
                    {error}
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Language editor (i18n) — anchovy-65959 scaffold.
// Reads + writes /api/profile-extras/[id]. On success the server sets
// the NEXT_LOCALE cookie so the next render uses the new catalog.
// ---------------------------------------------------------------------------

function LanguageEditor({ memberId }: { memberId: string }) {
    const router = useRouter();
    const t = useTranslations("language");
    const tCommon = useTranslations("common");

    const [locale, setLocale] = useState<SupportedLocale>("en");
    const [initialLocale, setInitialLocale] = useState<SupportedLocale>("en");
    const [loadingInitial, setLoadingInitial] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch(`/api/profile-extras/${memberId}`, {
                    credentials: "include",
                });
                if (!alive) return;
                if (res.ok) {
                    const json = await res.json();
                    const loaded = (SUPPORTED_LOCALES as readonly string[]).includes(
                        json?.locale
                    )
                        ? (json.locale as SupportedLocale)
                        : "en";
                    setLocale(loaded);
                    setInitialLocale(loaded);
                }
            } catch {
                // best-effort — stay on default
            } finally {
                if (alive) setLoadingInitial(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [memberId]);

    useEffect(() => {
        if (savedAt == null) return;
        const handle = setTimeout(() => setSavedAt(null), 1500);
        return () => clearTimeout(handle);
    }, [savedAt]);

    const dirty = locale !== initialLocale;

    const onSave = async () => {
        setError(null);
        setSaving(true);
        try {
            const res = await fetch(`/api/profile-extras/${memberId}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locale }),
            });
            if (!res.ok) {
                let msg = t("saveError");
                try {
                    const body = await res.json();
                    if (body?.error) msg = String(body.error);
                } catch {
                    /* swallow */
                }
                setError(msg);
                return;
            }
            setInitialLocale(locale);
            setSavedAt(Date.now());
            // RSC re-render picks up the new NEXT_LOCALE cookie that the server
            // just set, so any in-tree server components flip to the new
            // catalog on the next navigation.
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <select
                aria-label={t("selectLabel")}
                value={locale}
                onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                disabled={loadingInitial || saving}
                style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid hsl(var(--rule-warm) / 0.55)",
                    background: "hsl(var(--cream) / 0.4)",
                    color: "hsl(var(--foreground))",
                    fontSize: 14,
                    fontFamily: FONT_SANS,
                    appearance: "auto",
                }}
            >
                {SUPPORTED_LOCALES.map((code) => (
                    <option key={code} value={code}>
                        {t(`names.${code}`)}
                    </option>
                ))}
            </select>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !dirty || loadingInitial}
                    style={{
                        ...btn("primary"),
                        opacity: saving || !dirty || loadingInitial ? 0.5 : 1,
                        cursor:
                            saving || !dirty || loadingInitial ? "not-allowed" : "pointer",
                    }}
                >
                    {saving ? <Spinner /> : null}
                    {saving ? tCommon("loading") : t("saveButton")}
                </button>
                {savedAt && !error ? (
                    <span
                        role="status"
                        className="overline"
                        style={{ color: "hsl(var(--ink) / 0.55)" }}
                    >
                        § {tCommon("saved")}
                    </span>
                ) : null}
            </div>

            {error ? (
                <div
                    role="alert"
                    style={{
                        fontSize: 13,
                        color: "hsl(var(--destructive))",
                    }}
                >
                    {error}
                </div>
            ) : null}
        </div>
    );
}

function LanguageSection({ memberId }: { memberId: string }) {
    const t = useTranslations("language");
    return (
        <EditorialSection
            overline="§ 06 · Language"
            title={t("sectionTitle")}
            description={t("description")}
        >
            <LanguageEditor memberId={memberId} />
        </EditorialSection>
    );
}

// ---------------------------------------------------------------------------
// EditClient — the page body.
// ---------------------------------------------------------------------------

export function EditClient({ memberId }: { memberId: string }) {
    const { data: userData, isLoading, error } = useUserData(memberId);

    const orgsInitial = useMemo(
        () => String((userData as any)?.["Orgs"] ?? "") || "",
        [userData]
    );
    const skillsInitial = useMemo(
        () => String((userData as any)?.["Skills"] ?? "") || "",
        [userData]
    );
    const taglineInitial = useMemo(
        () => String((userData as any)?.["Tagline"] ?? "") || "",
        [userData]
    );

    if (isLoading) {
        return (
            <div
                className="min-h-screen bg-background text-foreground flex items-center justify-center"
                style={{ fontFamily: FONT_SANS }}
            >
                <div style={{ textAlign: "center" }}>
                    <div
                        style={{
                            width: 50,
                            height: 50,
                            border: "4px solid hsl(var(--ink) / 0.10)",
                            borderTop: "4px solid hsl(var(--tomato))",
                            borderRadius: "50%",
                            animation: "spin 1s linear infinite",
                            margin: "0 auto 20px",
                        }}
                    />
                    <p className="overline text-foreground/55">§ Pulling your dossier</p>
                    <style jsx>{`
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `}</style>
                </div>
            </div>
        );
    }

    if (error || !userData) {
        return (
            <div
                className="min-h-screen bg-background text-foreground flex items-center justify-center p-5"
                style={{ fontFamily: FONT_SANS }}
            >
                <div
                    className="paper-soft halftone-soft grid gap-3 rounded-[28px] border p-7 max-w-md w-full"
                    style={{
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                        borderColor: "hsl(var(--rule-warm) / 0.55)",
                        boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
                    }}
                >
                    <p className="overline text-tomato">§ Something stalled</p>
                    <h1
                        className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground m-0"
                        style={{ fontSize: "clamp(1.5rem, 3.6vw, 2rem)", lineHeight: 1.0 }}
                    >
                        Couldn't load your profile
                    </h1>
                    <p className="text-foreground/70 m-0">
                        {error instanceof Error
                            ? error.message
                            : "Please try again in a moment."}
                    </p>
                    <Link
                        href={`/dashboard/${memberId}`}
                        className="btn-pill self-start"
                        style={{
                            background: "hsl(var(--cream))",
                            color: "hsl(var(--ink))",
                            border: "1px solid hsl(var(--rule-warm) / 0.55)",
                        }}
                    >
                        ← Back to dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div
            className="min-h-screen bg-background text-foreground"
            style={{ fontFamily: FONT_SANS }}
        >
            <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10 grid gap-6 fade-up">
                {/* Top nav: back link + heading + view-public link */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="grid gap-2">
                        <Link
                            href={`/dashboard/${memberId}`}
                            className="overline text-foreground/55 hover:text-tomato transition-colors no-underline"
                        >
                            ← Back to dashboard
                        </Link>
                        <div className="relative inline-block">
                            <p className="overline text-tomato">§ The editorial desk</p>
                            <h1
                                className="font-[family-name:var(--font-display)] m-0 mt-2 font-black tracking-[-0.015em] text-foreground"
                                style={{
                                    fontSize: "clamp(2rem, 5.5vw, 3.25rem)",
                                    lineHeight: 0.95,
                                }}
                            >
                                Edit profile
                            </h1>
                            <span
                                aria-hidden
                                className="handwritten pointer-events-none hidden md:block absolute -top-2 right-[-110px] rotate-[-6deg]"
                                style={{
                                    color: "hsl(var(--tomato))",
                                    fontSize: 18,
                                    opacity: 0.8,
                                }}
                            >
                                draft, then live
                            </span>
                        </div>
                    </div>
                    <Link
                        href={`/profile/${memberId}`}
                        className="btn-pill self-end"
                        style={{
                            background: "hsl(var(--cream))",
                            color: "hsl(var(--ink))",
                            border: "1px solid hsl(var(--rule-warm) / 0.55)",
                        }}
                    >
                        View public profile →
                    </Link>
                </div>

                {/* Tagline — single-line public bio */}
                <EditorialSection
                    overline="§ 01 · The byline"
                    title="Tagline"
                    description="One line. Shows under your name on your profile and in social previews."
                    annotation="live"
                >
                    <TaglineEditor
                        memberId={memberId}
                        initialTagline={taglineInitial}
                    />
                </EditorialSection>

                {/* Status / About */}
                <EditorialSection
                    overline="§ 02 · About"
                    title="About"
                    description="How you show up on your public profile."
                >
                    <TextEditor
                        label="Orgs"
                        hint="Comma-separated. Companies, projects, DAOs you work with."
                        initial={orgsInitial}
                        endpoint="/api/update-orgs"
                        memberId={memberId}
                        fieldKey="orgs"
                        placeholder="e.g. PizzaDAO, Brooklyn Pizza Lab"
                    />
                    <TextEditor
                        label="Skills"
                        hint="Comma-separated. What you can help the DAO with."
                        initial={skillsInitial}
                        endpoint="/api/update-skills"
                        memberId={memberId}
                        fieldKey="skills"
                        placeholder="e.g. solidity, design, video editing"
                    />
                </EditorialSection>

                {/* Identity / Connections */}
                <EditorialSection
                    overline="§ 03 · Connections"
                    title="Connections"
                    description="Link your social accounts so the community can find and vouch for you."
                >
                    <XAccountEditor memberId={memberId} />
                    <SocialAccountLinker memberId={memberId} />
                </EditorialSection>

                {/* Profile links */}
                <EditorialSection
                    overline="§ 04 · Links"
                    title="Profile links"
                    description="Add your website, portfolio, and other links."
                >
                    <ProfileLinksEditor memberId={memberId} />
                </EditorialSection>

                {/* Language preference — wired via /api/profile-extras */}
                <LanguageSection memberId={memberId} />

                {/* Wallets pointer */}
                <EditorialSection
                    overline="§ 07 · Wallets"
                    title="Wallets"
                    description="Wallet management has its own page now."
                >
                    <div>
                        <Link
                            href="/me/wallets"
                            className="btn-pill"
                            style={{
                                background: "hsl(var(--ink))",
                                color: "hsl(var(--cream))",
                            }}
                        >
                            Manage wallets →
                        </Link>
                    </div>
                </EditorialSection>

                <div className="text-center mt-2">
                    <p className="overline text-foreground/35">§ End of the editorial desk</p>
                </div>
            </div>
        </div>
    );
}
