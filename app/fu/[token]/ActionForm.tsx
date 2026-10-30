"use client";

// The confirm step of a follow-up action link. Pressing the button is the only thing that changes
// anything (POST /api/fu/[token]); opening the page never does.

import { useState } from "react";

type Labels = {
    confirm: string;
    prompt: string;
    done: string;
    replyLabel: string;
    send: string;
    undo: string;
    undone: string;
    undoExpired: string;
    emptyReply: string;
    tooMany: string;
    error: string;
    closed: string;
    working: string;
};

const buttonClass = "rounded-lg border px-4 py-2 font-bold disabled:opacity-60";
const border = { borderColor: "hsl(var(--rule-warm) / 0.55)" };

export function ActionForm({ token, action, labels }: { token: string; action: string; labels: Labels }) {
    const [text, setText] = useState("");
    const [state, setState] = useState<"idle" | "busy" | "done" | "undone">("idle");
    const [message, setMessage] = useState<string | null>(null);

    async function post(body: Record<string, unknown>) {
        setState("busy");
        setMessage(null);
        try {
            const res = await fetch(`/api/fu/${encodeURIComponent(token)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
            if (res.ok && data.ok) return true;
            setState("idle");
            setMessage(res.status === 429 ? labels.tooMany : data.reason === "closed" ? labels.closed : data.reason === "empty" ? labels.emptyReply : labels.error);
        } catch {
            setState("idle");
            setMessage(labels.error);
        }
        return false;
    }

    async function confirm() {
        if (await post(action === "reply" ? { text } : {})) setState("done");
    }

    async function undo() {
        if (await post({ undo: true })) {
            setState("undone");
        } else {
            setMessage(labels.undoExpired);
        }
    }

    if (state === "undone") return <p role="status" className="m-0">{labels.undone}</p>;
    if (state === "done") {
        return (
            <div className="grid gap-3">
                <p role="status" className="m-0 font-bold">{labels.done}</p>
                {action === "stop" && (
                    <div>
                        <button type="button" onClick={undo} className={buttonClass} style={border}>{labels.undo}</button>
                    </div>
                )}
            </div>
        );
    }
    return (
        <div className="grid gap-3">
            <p className="m-0">{labels.prompt}</p>
            {action === "reply" && (
                <label className="grid gap-1">
                    <span className="text-sm text-foreground/60">{labels.replyLabel}</span>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={5}
                        maxLength={1000}
                        className="w-full rounded-lg border bg-background p-2"
                        style={border}
                    />
                </label>
            )}
            <div>
                <button type="button" onClick={confirm} disabled={state === "busy" || (action === "reply" && !text.trim())} className={buttonClass} style={border}>
                    {state === "busy" ? labels.working : action === "reply" ? labels.send : labels.confirm}
                </button>
            </div>
            {message && <p role="alert" className="m-0 text-sm text-tomato">{message}</p>}
        </div>
    );
}
