"use client";

// app/admin/support/AdminSupportClient.tsx
//
// Admin ticket queue: filter by status, change status, edit internal notes.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminTicket } from "@/app/lib/support-tickets";
import {
    ADMIN_NOTES_MAX_LEN,
    STATUS_LABELS,
    SUPPORT_STATUSES,
    type SupportStatus,
} from "@/app/lib/support-tickets-shared";
import { StatusBadge } from "@/app/support/SupportClient";

type Filter = SupportStatus | "ACTIVE" | "ALL";

const cardStyle: React.CSSProperties = {
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    borderColor: "hsl(var(--rule-warm) / 0.55)",
};

const controlStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid hsl(var(--rule-warm) / 0.55)",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    font: "inherit",
};

function TicketRow({ ticket, onSaved }: { ticket: AdminTicket; onSaved: (t: AdminTicket) => void }) {
    const [status, setStatus] = useState<SupportStatus>(ticket.status);
    const [notes, setNotes] = useState(ticket.adminNotes ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dirty = status !== ticket.status || notes.trim() !== (ticket.adminNotes ?? "");

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/support/tickets/${ticket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status, adminNotes: notes }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(String(json?.error || `Failed to save (${res.status})`));
                return;
            }
            onSaved(json.ticket as AdminTicket);
        } catch {
            setError("Network error, please try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="rounded-[18px] border p-4 grid gap-3" style={cardStyle}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <strong className="break-words">
                        #{ticket.id} · {ticket.subject}
                    </strong>
                    <p className="m-0 text-xs text-foreground/55">
                        {ticket.displayName || "Unknown"} · Discord {ticket.discordId}
                        {ticket.memberId ? (
                            <>
                                {" · "}
                                <Link href={`/profile/${ticket.memberId}`} className="underline">
                                    profile
                                </Link>
                            </>
                        ) : null}
                        {" · "}
                        {new Date(ticket.createdAt).toLocaleString()}
                    </p>
                </div>
                <StatusBadge status={ticket.status} />
            </div>
            <p className="m-0 text-sm whitespace-pre-wrap break-words">{ticket.body}</p>
            <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-start">
                <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Status</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)} style={controlStyle}>
                        {SUPPORT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Admin notes (internal)</span>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        maxLength={ADMIN_NOTES_MAX_LEN}
                        rows={2}
                        style={{ ...controlStyle, resize: "vertical" }}
                    />
                </label>
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || busy}
                    className="btn-pill"
                    style={{
                        background: "hsl(var(--ink))",
                        color: "hsl(var(--cream))",
                        opacity: !dirty || busy ? 0.5 : 1,
                        cursor: !dirty || busy ? "not-allowed" : "pointer",
                    }}
                >
                    {busy ? "Saving…" : "Save"}
                </button>
                {error ? (
                    <span role="alert" className="text-sm" style={{ color: "hsl(var(--destructive))" }}>
                        {error}
                    </span>
                ) : null}
            </div>
        </li>
    );
}

export function AdminSupportClient() {
    const [filter, setFilter] = useState<Filter>("ACTIVE");
    const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch("/api/admin/support/tickets", { cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || `Failed to load (${res.status})`);
            setTickets(json.tickets ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load tickets");
            setTickets([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const visible = (tickets ?? []).filter((t) =>
        filter === "ALL" ? true : filter === "ACTIVE" ? t.status !== "CLOSED" : t.status === filter,
    );

    const onSaved = (updated: AdminTicket) =>
        setTickets((prev) => (prev ?? []).map((t) => (t.id === updated.id ? updated : t)));

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10 grid gap-6">
                <header className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <p className="overline text-tomato m-0">§ Admin</p>
                        <h1 className="font-[family-name:var(--font-display)] font-black text-4xl m-0">Support queue</h1>
                    </div>
                    <label className="grid gap-1 text-sm">
                        <span className="font-semibold">Show</span>
                        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={controlStyle}>
                            <option value="ACTIVE">Open + in progress</option>
                            {SUPPORT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {STATUS_LABELS[s]}
                                </option>
                            ))}
                            <option value="ALL">All</option>
                        </select>
                    </label>
                </header>
                {error ? (
                    <p role="alert" className="m-0" style={{ color: "hsl(var(--destructive))" }}>
                        {error}
                    </p>
                ) : null}
                {tickets === null ? (
                    <p className="m-0 text-foreground/60">Loading…</p>
                ) : visible.length === 0 ? (
                    <p className="m-0 text-foreground/60">No tickets here.</p>
                ) : (
                    <ul className="m-0 p-0 list-none grid gap-3">
                        {visible.map((t) => (
                            <TicketRow key={`${t.id}-${t.updatedAt}`} ticket={t} onSaved={onSaved} />
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}
