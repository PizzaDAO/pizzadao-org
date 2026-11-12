"use client";

import { useCallback, useEffect, useState } from "react";
import type { NameReport } from "@/app/lib/members/name-reminders";

export function NamesClient() {
    const [report, setReport] = useState<NameReport | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch("/api/admin/members/names", { cache: "no-store" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Request failed");
            setReport(data as NameReport);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Request failed");
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const eligible = (report?.rows ?? []).filter((r) => r.discordId && !r.coolingDown);

    function toggle(id: string) {
        setPicked((p) => {
            const n = new Set(p);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    }

    async function send() {
        if (!picked.size || !confirm(`Send the name reminder DM to ${picked.size} member(s)?`)) return;
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/members/names", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberIds: [...picked] }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Request failed");
            setMessage(`Sent ${data.sent.length}, skipped ${data.skipped.length}, failed ${data.failed.length}.`);
            setPicked(new Set());
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Request failed");
        } finally {
            setBusy(false);
        }
    }

    if (error && !report) return <p className="text-red-500">{error}</p>;
    if (!report) return <p className="text-foreground/60">Loading...</p>;

    return (
        <div className="grid gap-4">
            <p>
                {report.nonThemed} of {report.total} members have a name that is not themed ({report.withoutDiscord} have no Discord id).
                Cooldown: {report.cooldownDays} days.
            </p>
            <div className="flex gap-3 items-center flex-wrap">
                <button className="rounded border border-foreground/20 px-3 py-1" onClick={() => setPicked(new Set(eligible.map((r) => r.id)))} disabled={busy}>
                    Select all eligible ({eligible.length})
                </button>
                <button className="rounded border border-foreground/20 px-3 py-1" onClick={() => setPicked(new Set())} disabled={busy}>Clear</button>
                <button className="rounded bg-foreground text-background px-3 py-1 disabled:opacity-50" onClick={send} disabled={busy || !picked.size}>
                    Send reminder ({picked.size})
                </button>
            </div>
            {message && <p className="text-green-600">{message}</p>}
            {error && <p className="text-red-500">{error}</p>}
            <ul className="grid gap-1">
                {report.rows.map((r) => {
                    const can = !!r.discordId && !r.coolingDown;
                    return (
                        <li key={r.id} className="flex gap-3 items-center">
                            <input type="checkbox" checked={picked.has(r.id)} disabled={!can || busy} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
                            <span className="grow">{r.name}</span>
                            <span className="text-foreground/50 text-sm">
                                {!r.discordId ? "no Discord id" : r.coolingDown ? `reminded ${r.lastReminderAt?.slice(0, 10)}` : r.lastReminderAt ? `last ${r.lastReminderAt.slice(0, 10)}` : ""}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
