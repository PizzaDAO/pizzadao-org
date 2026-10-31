"use client";

// app/ui/telegram/TelegramLinker.tsx
//
// "Link Telegram" row for /profile/[id]/edit (calzone-93434). Renders the
// official Telegram Login Widget; its data-onauth callback hands the signed
// user object to POST /api/telegram/account, which verifies the HMAC
// server-side. Renders nothing when the server reports Telegram as not
// configured (TELEGRAM_LOGIN_BOT_TOKEN / NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME unset).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type TelegramStatus = {
    enabled: boolean;
    botUsername?: string;
    connected: boolean;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    telegramDm?: { state: string; botUsername?: string | null };
};

type DmState = "unknown" | "ok" | "not_started" | "blocked";

type MatchCard = { state: "none" | "pending" | "awaiting" | "confirmed"; handleHint?: string | null; canSend?: boolean };

declare global {
    interface Window {
        onTelegramAuth?: (user: Record<string, unknown>) => void;
    }
}

const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";

function TelegramIcon() {
    return (
        <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ flexShrink: 0 }}
            aria-label="Telegram"
            role="img"
        >
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
    );
}

export function TelegramLinker() {
    const t = useTranslations("telegramLink");
    const [status, setStatus] = useState<TelegramStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [checkNote, setCheckNote] = useState<string | null>(null);
    const [match, setMatch] = useState<MatchCard | null>(null);
    const [matchBusy, setMatchBusy] = useState(false);
    const [matchNote, setMatchNote] = useState<string | null>(null);
    const widgetRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/telegram/account", { cache: "no-store" });
            if (!res.ok) {
                setStatus({ enabled: false, connected: false });
                return;
            }
            setStatus((await res.json()) as TelegramStatus);
        } catch {
            setStatus({ enabled: false, connected: false });
        }
    }, []);

    const loadMatch = useCallback(async () => {
        try {
            const res = await fetch("/api/telegram/host-match", { cache: "no-store" });
            setMatch(res.ok ? ((await res.json()) as MatchCard) : null);
        } catch {
            setMatch(null);
        }
    }, []);

    useEffect(() => {
        load();
        void loadMatch();
    }, [load, loadMatch]);

    const botUsername = status?.enabled && !status.connected ? status.botUsername : undefined;

    // Mount the Telegram widget script only while the "connect" state is shown.
    useEffect(() => {
        const container = widgetRef.current;
        if (!botUsername || !container) return;

        window.onTelegramAuth = async (user) => {
            setError(null);
            setBusy(true);
            try {
                const res = await fetch("/api/telegram/account", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(user),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(String(body?.error || `Failed to link Telegram (${res.status})`));
                    return;
                }
                await load();
            } catch {
                setError("Network error, please try again.");
            } finally {
                setBusy(false);
            }
        };

        const script = document.createElement("script");
        script.src = WIDGET_SRC;
        script.async = true;
        script.setAttribute("data-telegram-login", botUsername);
        script.setAttribute("data-size", "medium");
        script.setAttribute("data-radius", "20");
        script.setAttribute("data-userpic", "false");
        // No data-request-access: the login bot never sends, so it must not ask for write access.
        script.setAttribute("data-onauth", "onTelegramAuth(user)");
        container.appendChild(script);

        return () => {
            container.innerHTML = "";
            delete window.onTelegramAuth;
        };
    }, [botUsername, load]);

    // "Link with the Telegram app": get a one-time deep link, then poll until the bot has linked the account.
    const [appState, setAppState] = useState<"idle" | "starting" | "waiting">("idle");
    const [appNote, setAppNote] = useState<string | null>(null);
    const [appUrl, setAppUrl] = useState<string | null>(null);
    const [pending, setPending] = useState<{ username: string | null; name: string | null } | null>(null);
    const [pendingBusy, setPendingBusy] = useState(false);

    const onAppLink = async () => {
        setError(null);
        setAppNote(null);
        setAppState("starting");
        try {
            const res = await fetch("/api/telegram/link/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            const body = (await res.json().catch(() => ({}))) as { url?: string };
            if (!res.ok || !body.url) {
                setAppNote(t("appLinkFailed"));
                setAppState("idle");
                return;
            }
            // Open Telegram in a new tab and cut its link to this page (without the noopener feature, which makes
            // window.open return null). This tab never navigates away: if the browser blocks the popup, the
            // waiting state shows an "Open Telegram" link instead.
            setAppUrl(body.url);
            const w = window.open(body.url, "_blank");
            if (w) w.opener = null;
            setAppState("waiting");
        } catch {
            setAppNote(t("appLinkFailed"));
            setAppState("idle");
        }
    };

    useEffect(() => {
        if (appState !== "waiting") return;
        const startedAt = Date.now();
        const timer = setInterval(async () => {
            if (Date.now() - startedAt > 10 * 60 * 1000) {
                clearInterval(timer);
                setAppNote(t("appLinkTimeout"));
                setAppState("idle");
                return;
            }
            await load();
            try {
                const res = await fetch("/api/telegram/link/pending", { cache: "no-store" });
                const body = (await res.json().catch(() => ({}))) as { pending?: { username: string | null; name: string | null } | null };
                setPending(res.ok ? (body.pending ?? null) : null);
            } catch {
                // Try again on the next tick.
            }
        }, 3000);
        return () => clearInterval(timer);
    }, [appState, load, t]);

    useEffect(() => {
        if (status?.connected && appState !== "idle") setAppState("idle");
    }, [status?.connected, appState]);

    const onPending = async (action: "confirm" | "cancel") => {
        setPendingBusy(true);
        setAppNote(null);
        try {
            const res = await fetch("/api/telegram/link/pending", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (action === "confirm" && !res.ok) {
                const body = await res.json().catch(() => ({}));
                setAppNote(res.status === 409 ? String(body?.error ?? t("appLinkFailed")) : t("appLinkFailed"));
            }
            setPending(null);
            if (action === "cancel" || !res.ok) setAppState("idle");
            await load();
        } catch {
            setAppNote(t("appLinkFailed"));
        } finally {
            setPendingBusy(false);
        }
    };

    const onUnlink = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch("/api/telegram/account", { method: "DELETE" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(String(body?.error || `Failed to unlink (${res.status})`));
                return;
            }
            await load();
        } catch {
            setError("Network error, please try again.");
        } finally {
            setBusy(false);
        }
    };

    const onCheck = async () => {
        setCheckNote(null);
        setChecking(true);
        try {
            const res = await fetch("/api/telegram/account/check", { method: "POST" });
            const body = (await res.json().catch(() => ({}))) as { state?: string; preview?: boolean; tryLater?: boolean };
            if (res.status === 429) setCheckNote(t("dmTryLater"));
            else if (!res.ok) setCheckNote(t("dmCheckFailed"));
            else if (body.preview) setCheckNote(t("dmPreview"));
            else if (body.tryLater) setCheckNote(t("dmTryLater"));
            await load();
        } catch {
            setCheckNote(t("dmCheckFailed"));
        } finally {
            setChecking(false);
        }
    };

    // The suggested rsv.pizza match: the member answers here, then confirms again from the Telegram message.
    const onMatch = async (action: "confirm" | "send-confirmation" | "decline") => {
        setMatchNote(null);
        setMatchBusy(true);
        try {
            const res = await fetch("/api/telegram/host-match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const body = (await res.json().catch(() => ({}))) as { result?: string };
            if (res.status === 429) setMatchNote(t("matchTryLater"));
            else if (action !== "decline") {
                const r = body.result;
                setMatchNote(
                    r === "sent" ? t("matchSent")
                    : r === "not-started" ? t("matchNotStarted")
                    : r === "blocked" ? t("matchBlocked")
                    : r === "wait" ? t("matchWait")
                    : r === "try-later" ? t("matchTryLater")
                    : r === "has-login" || r === "not-found" ? null
                    : t("matchUnavailable"),
                );
            }
            await Promise.all([loadMatch(), load()]);
        } catch {
            setMatchNote(t("matchUnavailable"));
        } finally {
            setMatchBusy(false);
        }
    };

    const matchCard =
        match && match.state !== "none" ? (
            <div
                style={{
                    padding: 14,
                    borderRadius: 16,
                    border: "1px solid hsl(var(--rule-warm) / 0.55)",
                    background: "hsl(var(--cream) / 0.4)",
                    display: "grid",
                    gap: 8,
                    fontSize: 14,
                }}
            >
                <div className="overline" style={{ color: "hsl(var(--ink) / 0.55)" }}>{t("matchOverline")}</div>
                {match.state === "confirmed" ? (
                    <span>{t("matchConfirmed", { hint: match.handleHint ?? "" })}</span>
                ) : match.state === "awaiting" ? (
                    <span>{t("matchAwaiting", { hint: match.handleHint ?? "" })}</span>
                ) : (
                    <span>{t("matchAsk", { hint: match.handleHint ?? "" })}</span>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {match.state === "pending" ? (
                        <button type="button" onClick={() => onMatch("confirm")} disabled={matchBusy || !match.canSend} className="btn-pill" style={{ opacity: matchBusy || !match.canSend ? 0.5 : 1 }}>
                            {t("matchYes")}
                        </button>
                    ) : null}
                    {match.state === "awaiting" ? (
                        <button type="button" onClick={() => onMatch("send-confirmation")} disabled={matchBusy || !match.canSend} className="btn-pill" style={{ opacity: matchBusy || !match.canSend ? 0.5 : 1 }}>
                            {t("matchResend")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => onMatch("decline")}
                        disabled={matchBusy}
                        className="btn-pill"
                        style={{ background: "transparent", border: "1px solid hsl(var(--rule-warm) / 0.55)", color: "hsl(var(--foreground))", opacity: matchBusy ? 0.5 : 1 }}
                    >
                        {match.state === "confirmed" ? t("matchRemove") : t("matchNo")}
                    </button>
                    {match.canSend === false && match.state !== "confirmed" ? <span style={{ color: "hsl(var(--ink) / 0.55)" }}>{t("matchPreview")}</span> : null}
                    {matchNote ? <span role="status" style={{ color: "hsl(var(--ink) / 0.55)" }}>{matchNote}</span> : null}
                </div>
            </div>
        ) : null;

    if (!status?.enabled) return matchCard;

    const dmState = (status.telegramDm?.state ?? "unknown") as DmState;
    const senderBot = status.telegramDm?.botUsername ?? null;

    const label = status.username
        ? `@${status.username}`
        : [status.firstName, status.lastName].filter(Boolean).join(" ") || "Telegram account";

    const linker = (
        <div
            style={{
                padding: 14,
                borderRadius: 16,
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                background: "hsl(var(--cream) / 0.4)",
                display: "flex",
                alignItems: status.connected ? "center" : "flex-start",
                gap: 12,
                flexWrap: "wrap",
            }}
        >
            <TelegramIcon />
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                }}
            >
                {status.connected ? (
                    <>
                        <div>
                            {status.username ? (
                                <a
                                    href={`https://t.me/${status.username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                        fontWeight: 600,
                                        fontSize: 16,
                                        color: "hsl(var(--foreground))",
                                        textDecoration: "none",
                                    }}
                                >
                                    {label}
                                </a>
                            ) : (
                                <span style={{ fontWeight: 600, fontSize: 16 }}>{label}</span>
                            )}
                            <div
                                className="overline"
                                style={{ color: "hsl(var(--ink) / 0.55)", marginTop: 2 }}
                            >
                                § Telegram linked
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onUnlink}
                            disabled={busy}
                            className="btn-pill"
                            style={{
                                background: "transparent",
                                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                                color: "hsl(var(--foreground))",
                                opacity: busy ? 0.5 : 1,
                                cursor: busy ? "not-allowed" : "pointer",
                            }}
                        >
                            {busy ? "Unlinking…" : "Unlink"}
                        </button>
                    </>
                ) : (
                    <>
                        <div style={{ flexBasis: "100%" }}>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>
                                {busy ? "Linking Telegram…" : "Link your Telegram account"}
                            </div>
                            <div style={{ fontSize: 13, color: "hsl(var(--ink) / 0.55)", marginTop: 2 }}>{t("recognise")}</div>
                        </div>
                        <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
                            <div ref={widgetRef} style={{ display: "flex" }} aria-label="Log in with Telegram to link your account" />
                            <button
                                type="button"
                                onClick={onAppLink}
                                disabled={appState !== "idle"}
                                style={{
                                    background: "none",
                                    border: "none",
                                    padding: "4px 0",
                                    fontSize: 13,
                                    textAlign: "left",
                                    textDecoration: "underline",
                                    textUnderlineOffset: 3,
                                    color: "hsl(var(--ink) / 0.7)",
                                    opacity: appState !== "idle" ? 0.5 : 1,
                                    cursor: appState !== "idle" ? "not-allowed" : "pointer",
                                }}
                            >
                                {appState === "starting" ? t("appLinkOpening") : t("appLink")}
                            </button>
                        </div>
                        {appState === "waiting" || appNote ? <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
                            {appState === "waiting" && pending ? (
                                <div role="status" style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                                    <span>{pending.username
                                        ? t("appLinkPending", { who: `@${pending.username}` })
                                        : t("appLinkPendingNoUsername", { name: pending.name || "?" })}</span>
                                    <button type="button" onClick={() => onPending("confirm")} disabled={pendingBusy} className="btn-pill" style={{ opacity: pendingBusy ? 0.5 : 1 }}>
                                        {t("appLinkConfirm")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onPending("cancel")}
                                        disabled={pendingBusy}
                                        className="btn-pill"
                                        style={{ background: "transparent", border: "1px solid hsl(var(--rule-warm) / 0.55)", color: "hsl(var(--foreground))", opacity: pendingBusy ? 0.5 : 1 }}
                                    >
                                        {t("appLinkDeny")}
                                    </button>
                                </div>
                            ) : null}
                            {appState === "waiting" && !pending ? (
                                <>
                                    <span role="status" style={{ color: "hsl(var(--ink) / 0.55)" }}>{t("appLinkWaiting")}</span>
                                    {appUrl ? (
                                        <a href={appUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>
                                            {t("appLinkOpen")}
                                        </a>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => setAppState("idle")}
                                        style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", color: "hsl(var(--ink) / 0.7)", cursor: "pointer" }}
                                    >
                                        {t("appLinkCancel")}
                                    </button>
                                </>
                            ) : null}
                            {appNote ? <span role="status" style={{ color: "hsl(var(--ink) / 0.55)" }}>{appNote}</span> : null}
                        </div> : null}
                    </>
                )}
            </div>
            {status.connected && senderBot ? (
                <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ color: "hsl(var(--ink) / 0.7)" }}>
                        {dmState === "ok" ? t("dmOk") : dmState === "blocked" ? t("dmBlocked") : dmState === "not_started" ? t("dmNotStarted") : t("dmUnknown")}
                    </span>
                    {dmState !== "ok" && dmState !== "blocked" ? (
                        <a href={`https://t.me/${senderBot}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>
                            {t("dmStart")}
                        </a>
                    ) : null}
                    {dmState !== "ok" ? (
                        <button
                            type="button"
                            onClick={onCheck}
                            disabled={checking}
                            className="btn-pill"
                            style={{
                                background: "transparent",
                                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                                color: "hsl(var(--foreground))",
                                opacity: checking ? 0.5 : 1,
                                cursor: checking ? "not-allowed" : "pointer",
                            }}
                        >
                            {checking ? t("dmChecking") : t("dmCheck")}
                        </button>
                    ) : null}
                    {checkNote ? <span role="status" style={{ color: "hsl(var(--ink) / 0.55)" }}>{checkNote}</span> : null}
                </div>
            ) : null}
            {error ? (
                <div
                    role="alert"
                    style={{ flexBasis: "100%", fontSize: 13, color: "hsl(var(--destructive))" }}
                >
                    {error}
                </div>
            ) : null}
        </div>
    );

    if (!matchCard) return linker;
    return (
        <div style={{ display: "grid", gap: 12 }}>
            {linker}
            {matchCard}
        </div>
    );
}
