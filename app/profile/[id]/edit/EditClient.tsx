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
import { useTranslations } from "next-intl";
import { Field } from "../../../ui/onboarding/Field";
import { ProfileLinksEditor } from "../../../ui/profile-links";
import { SocialAccountLinker } from "../../../ui/vouches/SocialAccountLinker";
import { TelegramLinker } from "../../../ui/telegram/TelegramLinker";
import { TaglineEditor } from "../../../dashboard/[id]/components/TaglineEditor";
import { useUserData, useXAccount } from "../../../lib/hooks/use-api";
import { LanguageEditor } from "../../../ui/profile/LanguageEditor";
import { EmailPrefsEditor } from "./EmailPrefsEditor";

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
// Buttons use the shared .btn-pill-primary / .btn-pill-secondary classes
// (theme tokens, so they flip in dark mode); this is just the sizing.
// ---------------------------------------------------------------------------

const BTN_SIZE: React.CSSProperties = {
    minHeight: 44,
    fontSize: 13.5,
    textDecoration: "none",
    textAlign: "center",
};

function Spinner({ size = 12 }: { size?: number }) {
    return (
        <span
            aria-hidden
            style={{
                display: "inline-block",
                width: size,
                height: size,
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                borderRadius: "50%",
            }}
            className="animate-spin"
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
    const t = useTranslations("profileEdit");
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
            setError(t("tooLongKeep", { max: MAX_LEN }));
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
                setError(
                    res.status === 401 || res.status === 403
                        ? t("authFailed")
                        : t("saveFailedStatus", { status: res.status })
                );
                return;
            }
            setSavedAt(Date.now());
        } catch {
            setError(t("networkError"));
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
            error={error || (tooLong ? t("tooLongMax", { max: MAX_LEN }) : undefined)}
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
                        background: "hsl(var(--secondary))",
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
                        className="btn-pill btn-pill-primary"
                        style={BTN_SIZE}
                    >
                        {saving ? <Spinner /> : null}
                        {saving ? t("saving") : t("save")}
                    </button>
                    {savedAt && !error ? (
                        <span
                            role="status"
                            className="overline"
                            style={{ color: "hsl(var(--foreground) / 0.65)" }}
                        >
                            {t("saved")}
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

type XAccountState = {
    connected: boolean;
    username?: string;
    displayName?: string;
};

function XAccountEditor({
    memberId,
    xConfigured,
    override,
    onOverride,
}: {
    memberId: string;
    xConfigured: boolean;
    override: XAccountState | null;
    onOverride: (next: XAccountState) => void;
}) {
    const t = useTranslations("profileEdit.x");
    const tRoot = useTranslations("profileEdit");
    const { data, refetch, isLoading, isFetching } = useXAccount(memberId);
    // The override (set after a disconnect, owned by EditClient) wins over
    // the query data; deriving it avoids a render where data has loaded but
    // account is still null.
    const account: XAccountState | null = override ?? data ?? null;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDisconnect = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch("/api/x/disconnect", { method: "DELETE" });
            if (!res.ok) {
                setError(
                    res.status === 401 || res.status === 403
                        ? tRoot("authFailed")
                        : t("disconnectFailed", { status: res.status })
                );
                return;
            }
            onOverride({ connected: false });
            refetch();
        } catch {
            setError(tRoot("networkError"));
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
                background: "hsl(var(--secondary))",
                color: "hsl(var(--foreground))",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                // Reserve the height so the card doesn't jump when it loads.
                minHeight: 74,
                boxSizing: "border-box",
            }}
        >
            <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ flexShrink: 0 }}
                aria-label={t("ariaLabel")}
            >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
                {isLoading && !account ? (
                    <span
                        role="status"
                        style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.65)" }}
                    >
                        {t("loading")}
                    </span>
                ) : !account ? (
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
                            role="alert"
                            style={{ fontSize: 14, color: "hsl(var(--tomato-readable))" }}
                        >
                            {t("loadFailed")}
                        </span>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="btn-pill btn-pill-secondary"
                            style={BTN_SIZE}
                        >
                            {isFetching ? t("retrying") : tRoot("retry")}
                        </button>
                    </div>
                ) : account.connected ? (
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
                                    color: "hsl(var(--foreground) / 0.65)",
                                    marginTop: 2,
                                }}
                            >
                                {t("connected")}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onDisconnect}
                            disabled={busy}
                            className="btn-pill btn-pill-secondary"
                            style={BTN_SIZE}
                        >
                            {busy ? <Spinner /> : null}
                            {busy ? t("disconnecting") : t("disconnect")}
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
                                color: "hsl(var(--foreground) / 0.65)",
                            }}
                        >
                            {xConfigured ? t("prompt") : t("unavailable")}
                        </span>
                        {xConfigured ? (
                            <a
                                href={`/api/x/login?memberId=${memberId}`}
                                className="btn-pill btn-pill-primary"
                                style={BTN_SIZE}
                            >
                                {t("connect")}
                            </a>
                        ) : null}
                    </div>
                )}
            </div>
            {error ? (
                <div
                    role="alert"
                    style={{
                        flexBasis: "100%",
                        fontSize: 13,
                        color: "hsl(var(--tomato-readable))",
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
    const tp = useTranslations("profileEdit");
    return (
        <EditorialSection
            overline={tp("languageOverline")}
            title={t("sectionTitle")}
            description={t("description")}
        >
            <LanguageEditor memberId={memberId} />
        </EditorialSection>
    );
}

function EmailSection() {
    const t = useTranslations("reengage.prefs");
    const tp = useTranslations("profileEdit");
    return (
        <EditorialSection
            overline={tp("emailOverline")}
            title={t("sectionTitle")}
            description={t("description")}
        >
            <EmailPrefsEditor />
        </EditorialSection>
    );
}

// ---------------------------------------------------------------------------
// EditClient — the page body.
// ---------------------------------------------------------------------------

export function EditClient({
    memberId,
    xConfigured,
}: {
    memberId: string;
    xConfigured: boolean;
}) {
    const t = useTranslations("profileEdit");
    const { data: userData, isLoading, error } = useUserData(memberId);
    // Shared (cached) query with XAccountEditor. The manual X row is hidden
    // only when the verified X card can actually be used: X sign-in is
    // configured (or the member is already connected) and the lookup loaded.
    const { data: xData } = useXAccount(memberId);
    // After a disconnect the override wins, even if the refetch fails.
    const [xOverride, setXOverride] = useState<XAccountState | null>(null);
    const xAccount = xOverride ?? xData;
    const verifiedXAvailable =
        typeof xAccount?.connected === "boolean" &&
        (xConfigured || xAccount.connected === true);

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
                    <p className="overline text-foreground/65">{t("loadingOverline")}</p>
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
                    <p className="overline text-tomato">{t("stalledOverline")}</p>
                    <h1
                        className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground m-0"
                        style={{ fontSize: "clamp(1.5rem, 3.6vw, 2rem)", lineHeight: 1.0 }}
                    >
                        {t("loadFailedTitle")}
                    </h1>
                    <p className="text-foreground/70 m-0">
                        {error instanceof Error &&
                        (error.message === "__AUTH_401__" ||
                            error.message === "__AUTH_403__")
                            ? t("signInAgain")
                            : t("tryAgainLater")}
                    </p>
                    <Link
                        href={`/dashboard/${memberId}`}
                        className="btn-pill btn-pill-secondary self-start"
                    >
                        {t("backToDashboard")}
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
                            className="overline text-foreground/65 hover:text-tomato transition-colors no-underline"
                        >
                            {t("backToDashboard")}
                        </Link>
                        <div className="relative inline-block">
                            <p className="overline text-tomato">{t("deskOverline")}</p>
                            <h1
                                className="font-[family-name:var(--font-display)] m-0 mt-2 font-black tracking-[-0.015em] text-foreground"
                                style={{
                                    fontSize: "clamp(2rem, 5.5vw, 3.25rem)",
                                    lineHeight: 0.95,
                                }}
                            >
                                {t("pageTitle")}
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
                                {t("draftThenLive")}
                            </span>
                        </div>
                    </div>
                    <Link
                        href={`/profile/${memberId}`}
                        className="btn-pill btn-pill-secondary self-end"
                    >
                        {t("viewPublic")}
                    </Link>
                </div>

                {/* Tagline — single-line public bio */}
                <EditorialSection
                    overline={t("tagline.overline")}
                    title={t("tagline.title")}
                    description={t("tagline.description")}
                    annotation={t("live")}
                >
                    <TaglineEditor
                        memberId={memberId}
                        initialTagline={taglineInitial}
                    />
                </EditorialSection>

                {/* Status / About */}
                <EditorialSection
                    overline={t("about.overline")}
                    title={t("about.title")}
                    description={t("about.description")}
                >
                    <TextEditor
                        label={t("about.orgsLabel")}
                        hint={t("about.orgsHint")}
                        initial={orgsInitial}
                        endpoint="/api/update-orgs"
                        memberId={memberId}
                        fieldKey="orgs"
                        placeholder={t("about.orgsPlaceholder")}
                    />
                    <TextEditor
                        label={t("about.skillsLabel")}
                        hint={t("about.skillsHint")}
                        initial={skillsInitial}
                        endpoint="/api/update-skills"
                        memberId={memberId}
                        fieldKey="skills"
                        placeholder={t("about.skillsPlaceholder")}
                    />
                </EditorialSection>

                {/* Identity / Connections */}
                <EditorialSection
                    overline={t("connections.overline")}
                    title={t("connections.title")}
                    description={t("connections.description")}
                >
                    <XAccountEditor
                        memberId={memberId}
                        xConfigured={xConfigured}
                        override={xOverride}
                        onOverride={setXOverride}
                    />
                    <TelegramLinker />
                    <SocialAccountLinker
                        memberId={memberId}
                        hideManualX={verifiedXAvailable}
                    />
                </EditorialSection>

                {/* Profile links */}
                <EditorialSection
                    overline={t("links.overline")}
                    title={t("links.title")}
                    description={t("links.description")}
                >
                    <ProfileLinksEditor memberId={memberId} />
                </EditorialSection>

                {/* Language preference — wired via /api/profile-extras */}
                <LanguageSection memberId={memberId} />

                {/* Weekly re-engagement email opt-out — /api/email-prefs */}
                <EmailSection />

                {/* Wallets pointer */}
                <EditorialSection
                    overline={t("wallets.overline")}
                    title={t("wallets.title")}
                    description={t("wallets.description")}
                >
                    <div>
                        <Link
                            href="/me/wallets"
                            className="btn-pill btn-pill-primary"
                        >
                            {t("wallets.manage")}
                        </Link>
                    </div>
                </EditorialSection>

                <div className="text-center mt-2">
                    <p className="overline text-foreground/65">{t("endOverline")}</p>
                </div>
            </div>
        </div>
    );
}
