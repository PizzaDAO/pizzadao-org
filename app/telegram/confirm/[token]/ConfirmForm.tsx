"use client";

// The confirm step of a Telegram match link. Pressing the button is the only thing that changes
// anything (POST /api/telegram/host-match/confirm); opening the page never does.

import { useState } from "react";

type Labels = {
    confirm: string;
    working: string;
    done: string;
    error: string;
    tooMany: string;
    hasLogin: string;
    closed: string;
};

export function ConfirmForm({ token, labels }: { token: string; labels: Labels }) {
    const [state, setState] = useState<"idle" | "busy" | "done">("idle");
    const [message, setMessage] = useState<string | null>(null);

    async function confirm() {
        setState("busy");
        setMessage(null);
        try {
            const res = await fetch("/api/telegram/host-match/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
            if (res.ok && data.ok) {
                setState("done");
                return;
            }
            setState("idle");
            setMessage(
                res.status === 429
                    ? labels.tooMany
                    : data.reason === "has-login"
                      ? labels.hasLogin
                      : data.reason === "closed"
                        ? labels.closed
                        : labels.error,
            );
        } catch {
            setState("idle");
            setMessage(labels.error);
        }
    }

    if (state === "done") return <p role="status" className="m-0 font-bold">{labels.done}</p>;
    return (
        <div className="grid gap-3">
            <div>
                <button
                    type="button"
                    onClick={confirm}
                    disabled={state === "busy"}
                    className="rounded-lg border px-4 py-2 font-bold disabled:opacity-60"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                >
                    {state === "busy" ? labels.working : labels.confirm}
                </button>
            </div>
            {message && <p role="alert" className="m-0 text-sm text-tomato">{message}</p>}
        </div>
    );
}
