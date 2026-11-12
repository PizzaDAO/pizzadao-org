"use client";

import { useCallback, useEffect, useState } from "react";
import type { NameReport } from "@/app/lib/members/name-reminders";

const CAP = 20; // keep in step with MAX_PER_REQUEST (server file is not importable here)

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

    const eligible = (report?.rows ?? []).filter((r) => r.discordId && !r.coolingDown && r.lastStatus !== "CLOSED");

    function toggle(id: string) {
        setPicked((p) => {
            const n = new Set(p);
            if (n.has(id)) n.delete(id);
            else if (n.size < CAP) n.add(id);
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
                <button className="rounded border border-foreground/20 px-3 py-1" onClick={() => setPicked(new Set(eligible.slice(0, CAP).map((r) => r.id)))} disabled={busy}>
                    Select next {Math.min(CAP, eligible.length)} (of {eligible.length} eligible)
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
                                {!r.discordId ? "no Discord id" : r.coolingDown ? `${r.lastStatus === "CLOSED" ? "DMs closed" : "reminded"} ${r.lastReminderAt?.slice(0, 10)}` : r.lastStatus ? `last: ${r.lastStatus.toLowerCase()} ${r.lastReminderAt?.slice(0, 10)}` : ""}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
