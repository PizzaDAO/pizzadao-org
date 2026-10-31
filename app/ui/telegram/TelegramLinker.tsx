"use client";

// app/ui/telegram/TelegramLinker.tsx
//
// "Link Telegram" row for /profile/[id]/edit (calzone-93434). Renders the
// official Telegram Login Widget; its data-onauth callback hands the signed
// user object to POST /api/telegram/account, which verifies the HMAC
// server-side. Renders nothing when the server reports Telegram as not
// configured (TELEGRAM_LOGIN_BOT_TOKEN / NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME unset).

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { telegramErrorKey } from "./errors";

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

type MatchCard = {
    state: "none" | "pending" | "awaiting" | "confirmed";
    handleHint?: string | null;
    canSend?: boolean;
    senderBot?: string | null;
};

type MatchAction = "confirm" | "send-confirmation" | "decline";

declare global {
    interface Window {
        onTelegramAuth?: (user: Record<string, unknown>) => void;
    }
}

const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";

// Tokens that flip in dark mode (--ink / --cream do not).
const CARD_BG = "hsl(var(--secondary))";
const MUTED = "hsl(var(--foreground) / 0.65)";
const ERROR_COLOR = "hsl(var(--tomato-readable))";
const CARD_BORDER = "1px solid hsl(var(--rule-warm) / 0.55)";

// 44px minimum target for text-style actions.
const linkAction: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 44,
    background: "none",
    border: "none",
    padding: "0 2px",
    fontSize: 13,
    textAlign: "left",
    textDecoration: "underline",
    textUnderlineOffset: 3,
    color: "hsl(var(--foreground) / 0.8)",
    cursor: "pointer",
};

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
    const locale = useLocale();
    const [status, setStatus] = useState<TelegramStatus | null>(null);
    // Set when a load fails; only shown while nothing has loaded yet (a failed poll never hides the card).
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState<null | "link" | "unlink">(null);
    // Failures (red, role="alert"). Neutral progress text goes in the status line instead.
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [checkNote, setCheckNote] = useState<string | null>(null);
    const [match, setMatch] = useState<MatchCard | null>(null);
    const [matchBusy, setMatchBusy] = useState<MatchAction | null>(null);
    const [matchNote, setMatchNote] = useState<string | null>(null);
    const [matchError, setMatchError] = useState<string | null>(null);
    const [matchBotUrl, setMatchBotUrl] = useState<string | null>(null);
    const widgetRef = useRef<HTMLDivElement>(null);
    const [appState, setAppState] = useState<"idle" | "starting" | "waiting">("idle");
    // The widget's global callback outlives renders, so it reads the current step from a ref.
    const appStateRef = useRef(appState);
    useEffect(() => {
        appStateRef.current = appState;
    }, [appState]);

    const lastLoadStatus = useRef(200);
    // Resolves with the loaded status, or null when the load failed.
    const load = useCallback(async (): Promise<TelegramStatus | null> => {
        try {
            const res = await fetch("/api/telegram/account", { cache: "no-store" });
            lastLoadStatus.current = res.status;
            if (!res.ok) {
                setLoadFailed(true);
                return null;
            }
            const next = (await res.json()) as TelegramStatus;
            setStatus(next);
            setLoadFailed(false);
            return next;
        } catch {
            setLoadFailed(true);
            return null;
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
        void load();
        void loadMatch();
    }, [load, loadMatch]);

    const botUsername = status?.enabled && !status.connected ? status.botUsername : undefined;

    // Mount the Telegram widget script only while the "connect" state is shown.
    useEffect(() => {
        const container = widgetRef.current;
        if (!botUsername || !container) return;

        window.onTelegramAuth = async (user) => {
            // A widget login must not race the app flow's pending confirmation.
            if (appStateRef.current === "waiting") return;
            setError(null);
            setBusy("link");
            try {
                const res = await fetch("/api/telegram/account", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(user),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(t(telegramErrorKey(body?.code)));
                    return;
                }
                if (!(await load())) setError(t("errReload"));
            } catch {
                setError(t("errNetwork"));
            } finally {
                setBusy(null);
            }
        };

        const script = document.createElement("script");
        script.src = WIDGET_SRC;
        script.async = true;
        script.setAttribute("data-telegram-login", botUsername);
        // The large button is ~250px wide: fall back to the medium one on very narrow phones.
        script.setAttribute("data-size", window.innerWidth < 360 ? "medium" : "large");
        script.setAttribute("data-radius", "20");
        script.setAttribute("data-userpic", "false");
        script.setAttribute("data-lang", locale);
        // No data-request-access: the login bot never sends, so it must not ask for write access.
        script.setAttribute("data-onauth", "onTelegramAuth(user)");
        container.appendChild(script);

        return () => {
            container.innerHTML = "";
            delete window.onTelegramAuth;
        };
    }, [botUsername, load, locale, t]);

    // "Link with the Telegram app": get a one-time deep link, then poll until the bot has linked the account.
    const [appUrl, setAppUrl] = useState<string | null>(null);
    const [pending, setPending] = useState<{ username: string | null; name: string | null } | null>(null);
    const [pendingBusy, setPendingBusy] = useState<null | "confirm" | "cancel">(null);

    const onAppLink = async () => {
        setError(null);
        setPending(null);
        setAppState("starting");
        try {
            const res = await fetch("/api/telegram/link/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            const body = (await res.json().catch(() => ({}))) as { url?: string };
            if (!res.ok || !body.url) {
                setError(t("appLinkFailed"));
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
            setError(t("appLinkFailed"));
            setAppState("idle");
        }
    };

    useEffect(() => {
        if (appState !== "waiting") return;
        const startedAt = Date.now();
        // Set on cleanup so a tick that is already in flight can't write state after Cancel/timeout/connect.
        let cancelled = false;
        const expire = () => {
            cancelled = true;
            clearInterval(timer);
            setError(t("errSessionExpired"));
            setAppState("idle");
        };
        const timer = setInterval(async () => {
            if (Date.now() - startedAt > 10 * 60 * 1000) {
                cancelled = true;
                clearInterval(timer);
                setError(t("appLinkTimeout"));
                setAppState("idle");
                return;
            }
            await load();
            if (cancelled) return;
            if (lastLoadStatus.current === 401) return expire();
            try {
                const res = await fetch("/api/telegram/link/pending", { cache: "no-store" });
                if (cancelled) return;
                if (res.status === 401) return expire();
                // A failed poll keeps whatever is already shown (e.g. the Connect prompt).
                if (res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { pending?: { username: string | null; name: string | null } | null };
                    if (!cancelled) setPending(body.pending ?? null);
                }
            } catch {
                // Try again on the next tick.
            }
        }, 3000);
        return () => {
            cancelled = true;
            clearInterval(timer);
            setPending(null);
        };
    }, [appState, load, t]);

    useEffect(() => {
        if (status?.connected && appState !== "idle") setAppState("idle");
    }, [status?.connected, appState]);

    const onPending = async (action: "confirm" | "cancel") => {
        setPendingBusy(action);
        setError(null);
        try {
            const res = await fetch("/api/telegram/link/pending", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(t(action === "confirm" ? telegramErrorKey(body?.code, "appLinkFailed") : "actionFailed"));
                // A failed confirm ends this attempt (the code is gone or taken); a failed cancel can be retried.
                if (action === "confirm") {
                    setPending(null);
                    setAppState("idle");
                }
            } else {
                setPending(null);
                if (action === "cancel") setAppState("idle");
            }
            if (!(await load()) && res.ok) setError(t("errReload"));
        } catch {
            setError(t(action === "confirm" ? "appLinkFailed" : "actionFailed"));
        } finally {
            setPendingBusy(null);
        }
    };

    const onUnlink = async () => {
        setError(null);
        setCheckNote(null);
        setBusy("unlink");
        try {
            const res = await fetch("/api/telegram/account", { method: "DELETE" });
            if (!res.ok) {
                setError(t("errUnlinkFailed"));
                return;
            }
            if (!(await load())) setError(t("errReload"));
        } catch {
            setError(t("errNetwork"));
        } finally {
            setBusy(null);
        }
    };

    const onCheck = async () => {
        setCheckNote(null);
        setError(null);
        setChecking(true);
        const before = status?.telegramDm?.state;
        try {
            const res = await fetch("/api/telegram/account/check", { method: "POST" });
            const body = (await res.json().catch(() => ({}))) as { state?: string; preview?: boolean; tryLater?: boolean };
            let answered = true;
            if (res.status === 429) {
                setCheckNote(t("dmTryLater"));
                answered = false;
            } else if (!res.ok) {
                setError(t("dmCheckFailed"));
                answered = false;
            } else if (body.preview) {
                setCheckNote(t("dmPreview"));
                answered = false;
            } else if (body.tryLater) {
                setCheckNote(t("dmTryLater"));
                answered = false;
            }
            const next = await load();
            // The check ran but nothing changed: say so, so the button doesn't feel dead.
            if (answered && next && next.telegramDm?.state === before) setCheckNote(t("dmStillNo"));
        } catch {
            setError(t("dmCheckFailed"));
        } finally {
            setChecking(false);
        }
    };

    // The suggested rsv.pizza match: the member answers here, then confirms again from the Telegram message.
    const onMatch = async (action: MatchAction) => {
        setMatchNote(null);
        setMatchError(null);
        setMatchBotUrl(null);
        setMatchBusy(action);
        try {
            const res = await fetch("/api/telegram/host-match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const body = (await res.json().catch(() => ({}))) as { result?: string; senderBot?: string | null };
            if (res.status === 429) setMatchNote(t("matchTryLater"));
            else if (action === "decline") {
                // 404 means there was nothing left to decline: the reload below drops the card.
                if (!res.ok && res.status !== 404) setMatchError(t("actionFailed"));
            } else {
                const r = body.result;
                if (r === "sent") setMatchNote(t("matchSent"));
                else if (r === "not-started") {
                    setMatchNote(t("matchNotStarted"));
                    if (body.senderBot) setMatchBotUrl(`https://t.me/${body.senderBot}`);
                } else if (r === "blocked") setMatchError(t("matchBlocked"));
                else if (r === "wait") setMatchNote(t("matchWait"));
                else if (r === "try-later") setMatchNote(t("matchTryLater"));
                else if (r !== "has-login" && r !== "not-found") setMatchError(t("matchUnavailable"));
            }
            await Promise.all([loadMatch(), load()]);
        } catch {
            setMatchError(t("matchUnavailable"));
        } finally {
            setMatchBusy(null);
        }
    };

    const cardStyle: CSSProperties = {
        padding: 14,
        borderRadius: 16,
        border: CARD_BORDER,
        background: CARD_BG,
    };
    const errorStyle: CSSProperties = { flexBasis: "100%", fontSize: 13, color: ERROR_COLOR, overflowWrap: "anywhere" };

    const matchBusyOn = matchBusy !== null;
    const matchCard =
        match && match.state !== "none" ? (
            <div style={{ ...cardStyle, display: "grid", gap: 8, fontSize: 14, minWidth: 0, overflowWrap: "anywhere" }}>
                <div className="overline" style={{ color: MUTED }}>
                    {match.state === "confirmed" ? t("matchOverlineConfirmed") : match.state === "awaiting" ? t("matchOverlineAwaiting") : t("matchOverline")}
                </div>
                {match.state === "confirmed" ? (
                    <span>{t("matchConfirmed", { hint: match.handleHint ?? "" })}</span>
                ) : match.state === "awaiting" ? (
                    <span>{t("matchAwaiting", { hint: match.handleHint ?? "" })}</span>
                ) : (
                    <span>{t("matchAsk", { hint: match.handleHint ?? "" })}</span>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {match.state === "pending" ? (
                        <button
                            type="button"
                            onClick={() => onMatch("confirm")}
                            disabled={matchBusyOn || !match.canSend}
                            className="btn-pill btn-pill-primary"
                        >
                            {matchBusy === "confirm" ? t("matchSending") : t("matchYes")}
                        </button>
                    ) : null}
                    {match.state === "awaiting" ? (
                        <button
                            type="button"
                            onClick={() => onMatch("send-confirmation")}
                            disabled={matchBusyOn || !match.canSend}
                            className="btn-pill btn-pill-primary"
                        >
                            {matchBusy === "send-confirmation" ? t("matchSending") : t("matchResend")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => onMatch("decline")}
                        disabled={matchBusyOn}
                        className="btn-pill btn-pill-secondary"
                    >
                        {matchBusy === "decline" ? t("matchUpdating") : match.state === "confirmed" ? t("matchRemove") : t("matchNo")}
                    </button>
                    {match.canSend === false && match.state !== "confirmed" ? <span style={{ color: MUTED }}>{t("matchPreview")}</span> : null}
                </div>
                {/* Text only: buttons stay outside the live region. */}
                <div role="status" style={{ color: MUTED, fontSize: 13, marginTop: matchNote ? 0 : -8 }}>
                    {matchNote}
                </div>
                {matchBotUrl ? (
                    <a href={matchBotUrl} target="_blank" rel="noreferrer" style={{ ...linkAction, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                        {t("dmOpen")}
                    </a>
                ) : null}
                {matchError ? (
                    <div role="alert" style={{ fontSize: 13, color: ERROR_COLOR }}>
                        {matchError}
                    </div>
                ) : null}
            </div>
        ) : null;

    // Not configured (enabled:false) hides the Telegram card; a failed first load shows a retry instead.
    let main: ReactNode = null;
    if (status === null) {
        main = loadFailed ? (
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
                <span role="alert" style={{ fontSize: 14, color: ERROR_COLOR }}>
                    {t("loadFailed")}
                </span>
                <button
                    type="button"
                    className="btn-pill btn-pill-secondary"
                    onClick={() => {
                        setLoadFailed(false);
                        void load();
                    }}
                >
                    {t("retry")}
                </button>
            </div>
        ) : (
            <div aria-busy="true" className="animate-pulse" style={{ ...cardStyle, minHeight: 120 }} />
        );
    } else if (status.enabled) {
        const dmState = (status.telegramDm?.state ?? "unknown") as DmState;
        const senderBot = status.telegramDm?.botUsername ?? null;
        const waiting = appState === "waiting";

        const label = status.username
            ? `@${status.username}`
            : [status.firstName, status.lastName].filter(Boolean).join(" ") || t("accountFallback");

        const statusText = waiting
            ? pending
                ? pending.username
                    ? t("appLinkPending", { who: `@${pending.username}` })
                    : t("appLinkPendingNoUsername", { name: pending.name || "?" })
                : t("appLinkWaiting")
            : null;

        main = (
            <div
                style={{
                    ...cardStyle,
                    display: "flex",
                    alignItems: status.connected ? "center" : "flex-start",
                    columnGap: 12,
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
                            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
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
                                <div className="overline" style={{ color: MUTED, marginTop: 2 }}>
                                    {t("linked")}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onUnlink}
                                disabled={busy !== null}
                                className="btn-pill btn-pill-secondary"
                            >
                                {busy === "unlink" ? t("unlinking") : t("unlink")}
                            </button>
                        </>
                    ) : (
                        <div style={{ flexBasis: "100%", minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>
                                {busy === "link" ? t("linking") : t("linkTitle")}
                            </div>
                            <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{t("recognise")}</div>
                        </div>
                    )}
                </div>
                {!status.connected ? (
                    // Card-level row so the large widget has the full width. Hidden (not unmounted) while waiting on the
                    // app so only the current step shows and the widget script isn't reloaded afterwards.
                    <div
                        style={{
                            flexBasis: "100%",
                            display: waiting ? "none" : "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: "4px 14px",
                            marginTop: 10,
                            minWidth: 0,
                        }}
                    >
                        <div ref={widgetRef} style={{ display: "flex", maxWidth: "100%" }} aria-label={t("widgetLabel")} />
                        <button
                            type="button"
                            onClick={onAppLink}
                            disabled={appState !== "idle" || busy !== null}
                            style={{
                                ...linkAction,
                                opacity: appState !== "idle" || busy !== null ? 0.5 : 1,
                                cursor: appState !== "idle" || busy !== null ? "not-allowed" : "pointer",
                            }}
                        >
                            {appState === "starting" ? t("appLinkOpening") : t("appLink")}
                        </button>
                    </div>
                ) : null}
                {!status.connected && waiting ? (
                    <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", marginTop: 10 }}>
                        {pending ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onPending("confirm")}
                                    disabled={pendingBusy !== null || busy !== null}
                                    className="btn-pill btn-pill-primary"
                                >
                                    {pendingBusy === "confirm" ? t("appLinkConnecting") : t("appLinkConfirm")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onPending("cancel")}
                                    disabled={pendingBusy !== null || busy !== null}
                                    className="btn-pill btn-pill-secondary"
                                >
                                    {pendingBusy === "cancel" ? t("appLinkCancelling") : t("appLinkDeny")}
                                </button>
                            </>
                        ) : (
                            <>
                                {appUrl ? (
                                    <a
                                        href={appUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-pill btn-pill-primary"
                                    >
                                        {t("appLinkOpen")}
                                    </a>
                                ) : null}
                                <button type="button" onClick={() => setAppState("idle")} style={linkAction}>
                                    {t("appLinkCancel")}
                                </button>
                            </>
                        )}
                    </div>
                ) : null}
                {/* One always-mounted status line, text only (no buttons inside). */}
                <div
                    role="status"
                    style={{
                        flexBasis: "100%",
                        fontSize: 13,
                        color: MUTED,
                        overflowWrap: "anywhere",
                        marginTop: statusText ? 8 : 0,
                    }}
                >
                    {statusText}
                </div>
                {status.connected && senderBot ? (
                    <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, marginTop: 10 }}>
                        <span style={{ color: MUTED, flexBasis: "100%" }}>
                            {dmState === "ok" ? t("dmOk") : dmState === "blocked" ? t("dmBlocked") : dmState === "not_started" ? t("dmNotStarted") : t("dmUnknown")}
                        </span>
                        {dmState !== "ok" ? (
                            <a
                                href={`https://t.me/${senderBot}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-pill btn-pill-primary"
                            >
                                {dmState === "blocked" ? t("dmOpen") : t("dmStart")}
                            </a>
                        ) : null}
                        {dmState !== "ok" ? (
                            <button
                                type="button"
                                onClick={onCheck}
                                disabled={checking}
                                className="btn-pill btn-pill-secondary"
                            >
                                {checking ? t("dmChecking") : t("dmCheck")}
                            </button>
                        ) : null}
                        <span aria-live="polite" style={{ flexBasis: "100%", color: MUTED, overflowWrap: "anywhere" }}>
                            {checkNote}
                        </span>
                    </div>
                ) : null}
                {error ? (
                    <div role="alert" style={{ ...errorStyle, marginTop: 8 }}>
                        {error}
                    </div>
                ) : null}
            </div>
        );
    }

    if (!main && !matchCard) return null;
    if (!matchCard) return main;
    if (!main) return matchCard;
    return (
        <div style={{ display: "grid", gap: 12 }}>
            {main}
            {matchCard}
        </div>
    );
}
