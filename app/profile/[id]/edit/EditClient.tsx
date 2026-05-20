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
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Field } from "../../../ui/onboarding/Field";
import { ProfileLinksEditor } from "../../../ui/profile-links";
import { SocialAccountLinker } from "../../../ui/vouches/SocialAccountLinker";
import { TaglineEditor } from "../../../dashboard/[id]/components/TaglineEditor";
import { useUserData, useXAccount } from "../../../lib/hooks/use-api";

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";
const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

const MAX_LEN = 500;

// ---------------------------------------------------------------------------
// Local style helpers — mirrors the dashboard's previous local helpers so the
// visual language stays identical post-move. No new design tokens.
// ---------------------------------------------------------------------------

function card(): React.CSSProperties {
    return {
        border: "1px solid hsl(var(--rule) / 0.12)",
        borderRadius: "var(--radius)",
        padding: 24,
        boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid transparent",
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        fontSize: 13,
        transition:
            "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    };
    if (kind === "primary") {
        return {
            ...base,
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            borderColor: "hsl(var(--primary))",
        };
    }
    return {
        ...base,
        background: "hsl(var(--secondary))",
        color: "hsl(var(--secondary-foreground))",
        borderColor: "hsl(var(--rule) / 0.22)",
    };
}

function sectionTitle(): React.CSSProperties {
    return {
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        letterSpacing: "-0.01em",
        color: "hsl(var(--foreground))",
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
                border: "2px solid hsl(var(--primary-foreground) / 0.35)",
                borderTopColor: "hsl(var(--primary-foreground))",
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
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid hsl(var(--rule) / 0.22)",
                        background: "hsl(var(--background))",
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
                            style={{
                                fontSize: 13,
                                color: "hsl(var(--muted-foreground))",
                            }}
                        >
                            Saved
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
                padding: 16,
                borderRadius: 12,
                border: "1px solid hsl(var(--rule) / 0.12)",
                background: "hsl(var(--card))",
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
                                style={{
                                    fontSize: 12,
                                    color: "hsl(var(--muted-foreground))",
                                    marginTop: 2,
                                }}
                            >
                                Connected
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
                                color: "hsl(var(--muted-foreground))",
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
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    fontFamily: FONT_SANS,
                }}
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
                    <p style={{ color: "hsl(var(--muted-foreground))" }}>
                        Loading your profile…
                    </p>
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
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    fontFamily: FONT_SANS,
                    padding: 20,
                }}
            >
                <div style={card()}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: 24,
                            fontFamily: FONT_DISPLAY,
                            fontWeight: 800,
                        }}
                    >
                        Couldn't load your profile
                    </h1>
                    <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
                        {error instanceof Error
                            ? error.message
                            : "Please try again in a moment."}
                    </p>
                    <Link
                        href={`/dashboard/${memberId}`}
                        style={btn("secondary")}
                    >
                        ← Back to dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
                padding: "40px 20px",
            }}
        >
            <div
                style={{
                    maxWidth: 800,
                    margin: "0 auto",
                    display: "grid",
                    gap: 20,
                }}
            >
                {/* Top nav: back + heading */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <Link
                            href={`/dashboard/${memberId}`}
                            style={{
                                fontSize: 14,
                                color: "hsl(var(--muted-foreground))",
                                textDecoration: "none",
                            }}
                        >
                            ← Back to dashboard
                        </Link>
                        <h1
                            style={{
                                margin: "4px 0 0",
                                fontSize: 32,
                                fontFamily: FONT_DISPLAY,
                                fontWeight: 800,
                                letterSpacing: "-0.01em",
                            }}
                        >
                            Edit profile
                        </h1>
                    </div>
                    <Link
                        href={`/profile/${memberId}`}
                        style={btn("secondary")}
                    >
                        View public profile
                    </Link>
                </div>

                {/* Tagline — single-line public bio */}
                <section style={card()}>
                    <h2 style={sectionTitle()}>Tagline</h2>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                        }}
                    >
                        One line. Shows under your name on your profile and in social previews.
                    </p>
                    <TaglineEditor
                        memberId={memberId}
                        initialTagline={taglineInitial}
                    />
                </section>

                {/* Status / About */}
                <section style={card()}>
                    <h2 style={sectionTitle()}>About</h2>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                        }}
                    >
                        How you show up on your public profile.
                    </p>
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
                </section>

                {/* Identity / Connections */}
                <section style={card()}>
                    <h2 style={sectionTitle()}>Connections</h2>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                        }}
                    >
                        Link your social accounts so the community can find and vouch for you.
                    </p>
                    <XAccountEditor memberId={memberId} />
                    <SocialAccountLinker memberId={memberId} />
                </section>

                {/* Profile links */}
                <section style={card()}>
                    <h2 style={sectionTitle()}>Profile links</h2>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                        }}
                    >
                        Add your website, portfolio, and other links.
                    </p>
                    <ProfileLinksEditor memberId={memberId} />
                </section>

                {/* Wallets pointer */}
                <section style={card()}>
                    <h2 style={sectionTitle()}>Wallets</h2>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                        }}
                    >
                        Wallet management has its own page now.
                    </p>
                    <div>
                        <Link href="/me/wallets" style={btn("primary")}>
                            Manage wallets →
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
}
