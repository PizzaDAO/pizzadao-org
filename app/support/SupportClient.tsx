"use client";

// app/support/SupportClient.tsx
//
// Ticket form + "your tickets" list for /support (buffalo-96244).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { MemberTicket } from "@/app/lib/support-tickets";
import { BODY_MAX_LEN, STATUS_LABELS, SUBJECT_MAX_LEN } from "@/app/lib/support-tickets-shared";

export function StatusBadge({ status }: { status: MemberTicket["status"] }) {
    const color =
        status === "OPEN"
            ? "hsl(var(--tomato))"
            : status === "IN_PROGRESS"
              ? "hsl(var(--ink) / 0.75)"
              : "hsl(var(--ink) / 0.45)";
    return (
        <span
            className="overline"
            style={{
                border: `1px solid ${color}`,
                color,
                borderRadius: 999,
                padding: "2px 10px",
                whiteSpace: "nowrap",
            }}
        >
            {STATUS_LABELS[status]}
        </span>
    );
}

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

export function SupportClient({ isAdmin }: { isAdmin: boolean }) {
    const [tickets, setTickets] = useState<MemberTicket[] | null>(null);
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/support/tickets", { cache: "no-store" });
            if (!res.ok) throw new Error();
            const json = await res.json();
            setTickets(json.tickets ?? []);
        } catch {
            setTickets([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setBusy(true);
        try {
            const res = await fetch("/api/support/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subject, body }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(String(json?.error || `Failed to submit (${res.status})`));
                return;
            }
            setSubject("");
            setBody("");
            setNotice("Thanks! Your ticket was sent to the team.");
            await load();
        } catch {
            setError("Network error, please try again.");
        } finally {
            setBusy(false);
        }
    };

    const canSubmit =
        !busy &&
        subject.trim().length > 0 &&
        body.trim().length > 0 &&
        subject.length <= SUBJECT_MAX_LEN &&
        body.length <= BODY_MAX_LEN;

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10 grid gap-6 fade-up">
                <header className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <p className="overline text-tomato m-0">§ Support</p>
                        <h1
                            className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] m-0"
                            style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1 }}
                        >
                            Support desk
                        </h1>
                        <p className="m-0 mt-2 text-foreground/70">
                            Something broken or confusing? Open a ticket and the team will take a look.
                        </p>
                    </div>
                    {isAdmin ? (
                        <Link href="/admin/support" className="btn-pill" style={{ border: "1px solid hsl(var(--ink))" }}>
                            Admin queue →
                        </Link>
                    ) : null}
                </header>

                <form onSubmit={onSubmit} className="paper-soft grid gap-4 rounded-[24px] border p-5 sm:p-6" style={cardStyle}>
                    <h2 className="m-0 text-xl font-bold">New ticket</h2>
                    <label className="grid gap-1">
                        <span className="text-sm font-semibold">Subject</span>
                        <input
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            maxLength={SUBJECT_MAX_LEN}
                            placeholder="Short summary"
                            required
                            style={inputStyle}
                        />
                        <span className="text-xs text-foreground/50">
                            {subject.length}/{SUBJECT_MAX_LEN}
                        </span>
                    </label>
                    <label className="grid gap-1">
                        <span className="text-sm font-semibold">Details</span>
                        <textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            maxLength={BODY_MAX_LEN}
                            rows={6}
                            placeholder="What happened? What did you expect? Include links or page names if you can."
                            required
                            style={{ ...inputStyle, resize: "vertical" }}
                        />
                        <span className="text-xs text-foreground/50">
                            {body.length}/{BODY_MAX_LEN}
                        </span>
                    </label>
                    {error ? (
                        <p role="alert" className="m-0 text-sm" style={{ color: "hsl(var(--destructive))" }}>
                            {error}
                        </p>
                    ) : null}
                    {notice ? (
                        <p role="status" className="m-0 text-sm text-foreground/80">
                            {notice}
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
                        {busy ? "Sending…" : "Submit ticket"}
                    </button>
                </form>

                <section className="grid gap-3">
                    <h2 className="m-0 text-xl font-bold">Your tickets</h2>
                    {tickets === null ? (
                        <p className="m-0 text-foreground/60">Loading…</p>
                    ) : tickets.length === 0 ? (
                        <p className="m-0 text-foreground/60">No tickets yet.</p>
                    ) : (
                        <ul className="m-0 p-0 list-none grid gap-3">
                            {tickets.map((t) => (
                                <li key={t.id} className="rounded-[18px] border p-4 grid gap-2" style={cardStyle}>
                                    <div className="flex items-start justify-between gap-3">
                                        <strong className="break-words">
                                            #{t.id} · {t.subject}
                                        </strong>
                                        <StatusBadge status={t.status} />
                                    </div>
                                    <p className="m-0 text-sm text-foreground/75 whitespace-pre-wrap break-words">{t.body}</p>
                                    <p className="m-0 text-xs text-foreground/50">
                                        Opened {new Date(t.createdAt).toLocaleString()}
                                        {t.closedAt ? ` · Closed ${new Date(t.closedAt).toLocaleString()}` : ""}
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
