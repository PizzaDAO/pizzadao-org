"use client";

// app/ui/telegram/TelegramLinker.tsx
//
// "Link Telegram" row for /profile/[id]/edit (calzone-93434). Renders the
// official Telegram Login Widget; its data-onauth callback hands the signed
// user object to POST /api/telegram/account, which verifies the HMAC
// server-side. Renders nothing when the server reports Telegram as not
// configured (TELEGRAM_BOT_TOKEN / NEXT_PUBLIC_TELEGRAM_BOT_USERNAME unset).

import { useCallback, useEffect, useRef, useState } from "react";

type TelegramStatus = {
    enabled: boolean;
    botUsername?: string;
    connected: boolean;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
};

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
    const [status, setStatus] = useState<TelegramStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
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

    useEffect(() => {
        load();
    }, [load]);

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
        script.setAttribute("data-onauth", "onTelegramAuth(user)");
        container.appendChild(script);

        return () => {
            container.innerHTML = "";
            delete window.onTelegramAuth;
        };
    }, [botUsername, load]);

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

    if (!status?.enabled) return null;

    const label = status.username
        ? `@${status.username}`
        : [status.firstName, status.lastName].filter(Boolean).join(" ") || "Telegram account";

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
                        <span style={{ fontSize: 14, color: "hsl(var(--ink) / 0.7)" }}>
                            {busy ? "Linking Telegram…" : "Link your Telegram account"}
                        </span>
                        <div ref={widgetRef} aria-label="Log in with Telegram to link your account" />
                    </>
                )}
            </div>
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
}
