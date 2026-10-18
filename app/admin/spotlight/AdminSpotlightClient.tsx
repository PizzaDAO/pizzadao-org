"use client";

// app/admin/spotlight/AdminSpotlightClient.tsx
//
// Admin Mafia Spotlight queue (blackolive-55617): filter by status, change
// status, set the featured call date, edit internal notes, copy call notes.
// English only, like /admin/support.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminSubmission } from "@/app/lib/spotlight";
import {
    ADMIN_NOTES_MAX_LEN,
    SPOTLIGHT_STATUSES,
    SPOTLIGHT_STATUS_LABELS,
    type SpotlightStatus,
} from "@/app/lib/spotlight-shared";

type Filter = SpotlightStatus | "ACTIVE" | "ALL";

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

const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function callNotes(s: AdminSubmission): string {
    return [
        `Mafia Spotlight: ${s.nomineeName}${s.isSelf ? " (self-nominated)" : ""}`,
        s.city ? `City: ${s.city}` : null,
        s.nomineeDiscord ? `Discord: ${s.nomineeDiscord}` : null,
        `Submitted by: ${s.submitterName || s.submitterDiscordId}`,
        "",
        s.pitch,
        s.links.length ? `\nLinks:\n${s.links.join("\n")}` : null,
        s.photoUrl ? `\nPhoto: ${s.photoUrl}` : null,
    ]
        .filter((x) => x !== null)
        .join("\n");
}

function Row({ item, onSaved }: { item: AdminSubmission; onSaved: (s: AdminSubmission) => void }) {
    const [status, setStatus] = useState<SpotlightStatus>(item.status);
    const [featuredOn, setFeaturedOn] = useState(isoDay(item.featuredOn));
    const [notes, setNotes] = useState(item.adminNotes ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const dirty =
        status !== item.status || featuredOn !== isoDay(item.featuredOn) || notes.trim() !== (item.adminNotes ?? "");

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const body: Record<string, unknown> = { adminNotes: notes };
            if (status !== item.status) body.status = status;
            if (featuredOn !== isoDay(item.featuredOn)) body.featuredOn = featuredOn || null;
            const res = await fetch(`/api/admin/spotlight/submissions/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(String(json?.error || `Failed to save (${res.status})`));
                return;
            }
            onSaved(json.submission as AdminSubmission);
        } catch {
            setError("Network error, please try again.");
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(callNotes(item));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("Could not copy to the clipboard.");
        }
    };

    return (
        <li className="rounded-[18px] border p-4 grid gap-3" style={cardStyle}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <strong className="break-words">
                        #{item.id} · {item.nomineeName}
                        {item.isSelf ? " (self)" : ""}
                    </strong>
                    <p className="m-0 text-xs text-foreground/55">
                        From {item.submitterName || "Unknown"} · Discord {item.submitterDiscordId}
                        {item.submitterMemberId ? (
                            <>
                                {" · "}
                                <Link href={`/profile/${item.submitterMemberId}`} className="underline">
                                    profile
                                </Link>
                            </>
                        ) : null}
                        {item.nomineeDiscord ? ` · Nominee Discord: ${item.nomineeDiscord}` : ""}
                        {item.city ? ` · ${item.city}` : ""}
                        {" · "}
                        {new Date(item.createdAt).toLocaleString()}
                        {item.consent ? "" : " · NO CONSENT"}
                    </p>
                </div>
                <span className="overline" style={{ whiteSpace: "nowrap" }}>
                    {SPOTLIGHT_STATUS_LABELS[item.status]}
                </span>
            </div>
            <p className="m-0 text-sm whitespace-pre-wrap break-words">{item.pitch}</p>
            {item.links.length ? (
                <ul className="m-0 pl-5 text-sm break-all">
                    {item.links.map((l) => (
                        <li key={l}>
                            <a href={l} target="_blank" rel="noopener noreferrer" className="underline">
                                {l}
                            </a>
                        </li>
                    ))}
                </ul>
            ) : null}
            {item.photoUrl ? (
                <a href={item.photoUrl} target="_blank" rel="noopener noreferrer" className="self-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.photoUrl} alt="" width={96} height={96} style={{ objectFit: "cover", borderRadius: 12, width: 96, height: 96 }} />
                </a>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-start">
                <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Status</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value as SpotlightStatus)} style={controlStyle}>
                        {SPOTLIGHT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {SPOTLIGHT_STATUS_LABELS[s]}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Featured on</span>
                    <input type="date" value={featuredOn} onChange={(e) => setFeaturedOn(e.target.value)} style={controlStyle} />
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
            <div className="flex items-center gap-3 flex-wrap">
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
                <button type="button" onClick={copy} className="btn-pill" style={{ border: "1px solid hsl(var(--ink))" }}>
                    {copied ? "Copied!" : "Copy for call notes"}
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

export function AdminSpotlightClient() {
    const [filter, setFilter] = useState<Filter>("ACTIVE");
    const [items, setItems] = useState<AdminSubmission[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch("/api/admin/spotlight/submissions", { cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || `Failed to load (${res.status})`);
            setItems(json.submissions ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load submissions");
            setItems([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const visible = (items ?? []).filter((s) =>
        filter === "ALL"
            ? true
            : filter === "ACTIVE"
              ? s.status === "NEW" || s.status === "SHORTLISTED"
              : s.status === filter,
    );

    const onSaved = (updated: AdminSubmission) =>
        setItems((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)));

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10 grid gap-6">
                <header className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <p className="overline text-tomato m-0">§ Admin</p>
                        <h1 className="font-[family-name:var(--font-display)] font-black text-4xl m-0">Spotlight queue</h1>
                    </div>
                    <label className="grid gap-1 text-sm">
                        <span className="font-semibold">Show</span>
                        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={controlStyle}>
                            <option value="ACTIVE">New + shortlisted</option>
                            {SPOTLIGHT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {SPOTLIGHT_STATUS_LABELS[s]}
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
                {items === null ? (
                    <p className="m-0 text-foreground/60">Loading…</p>
                ) : visible.length === 0 ? (
                    <p className="m-0 text-foreground/60">No submissions here.</p>
                ) : (
                    <ul className="m-0 p-0 list-none grid gap-3">
                        {visible.map((s) => (
                            <Row key={`${s.id}-${s.updatedAt}`} item={s} onSaved={onSaved} />
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}
