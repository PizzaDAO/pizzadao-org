"use client";

// app/admin/calls/attendance/AttendanceCompare.tsx
//
// The compare report plus add/remove. Removing is only offered for people counted from recordings or added by hand
// (sheet rows come from the sheets). Every change goes through /api/admin/calls/attendance and is audited there.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CompareDay, ComparePerson } from "@/app/lib/calls/attendance-compare";

export interface EditRow {
    id: number;
    action: string;
    discordId: string;
    crewId: string;
    date: string;
    actorId: string;
    reason: string | null;
    source: string | null;
    at: string;
}

const label = (p: ComparePerson) => `${p.name ?? p.discordId}${p.minutes != null ? ` (${p.minutes} min)` : ""}`;

function PersonList({ title, people, tone, onRemove }: { title: string; people: ComparePerson[]; tone: string; onRemove?: (p: ComparePerson) => void }) {
    return (
        <div className="grid gap-1 content-start">
            <p className={`m-0 text-xs font-bold uppercase ${tone}`}>
                {title} ({people.length})
            </p>
            {people.length === 0 ? (
                <p className="m-0 text-sm text-foreground/40">None</p>
            ) : (
                <ul className="m-0 p-0 list-none grid gap-0.5 text-sm">
                    {people.map((p) => (
                        <li key={p.discordId} className="flex items-center gap-2">
                            <span>{label(p)}</span>
                            {onRemove && (
                                <button type="button" onClick={() => onRemove(p)} className="text-xs underline text-tomato-readable bg-transparent border-0 p-0 cursor-pointer">
                                    remove
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function AttendanceCompare({ report, edits }: { report: CompareDay[]; edits: EditRow[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [form, setForm] = useState({ discordId: "", crewId: "", date: "", reason: "" });

    async function send(body: Record<string, string>) {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/calls/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) setMessage(data.error ?? "Something went wrong");
            else {
                setMessage("Saved");
                router.refresh();
            }
        } catch {
            setMessage("Something went wrong");
        } finally {
            setBusy(false);
        }
    }

    function remove(day: CompareDay, p: ComparePerson) {
        const reason = window.prompt(`Remove ${p.name ?? p.discordId} from ${day.crewLabel} on ${day.date}? Optional reason:`);
        if (reason === null) return;
        void send({ action: "remove", discordId: p.discordId, crewId: day.crewId, date: day.date, reason });
    }

    const totals = report.reduce((n, d) => ({ both: n.both + d.both.length, rec: n.rec + d.recordingOnly.length, sheet: n.sheet + d.sheetOnly.length }), { both: 0, rec: 0, sheet: 0 });

    return (
        <div className="grid gap-6">
            <p className="m-0 text-sm text-foreground/70">
                Total: {totals.both} in both, {totals.rec} recording only, {totals.sheet} sheet only.
            </p>

            <form
                className="grid gap-2 border border-foreground/15 rounded-lg p-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    void send({ action: "add", ...form });
                }}
            >
                <h2 className="m-0 text-lg font-bold">Add an attendee</h2>
                <div className="flex flex-wrap gap-2">
                    <input required placeholder="Discord id" value={form.discordId} onChange={(e) => setForm({ ...form, discordId: e.target.value })} className="border border-foreground/20 rounded px-2 py-1 bg-background" />
                    <input required placeholder="Crew id (ops, community_call)" value={form.crewId} onChange={(e) => setForm({ ...form, crewId: e.target.value })} className="border border-foreground/20 rounded px-2 py-1 bg-background" />
                    <input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="border border-foreground/20 rounded px-2 py-1 bg-background" />
                    <input placeholder="Reason (optional)" maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="border border-foreground/20 rounded px-2 py-1 bg-background" />
                    <button type="submit" disabled={busy} className="btn-pill">
                        Add
                    </button>
                </div>
                {message && <p className="m-0 text-sm" role="status">{message}</p>}
            </form>

            {report.length === 0 ? (
                <p className="text-foreground/60">No calls in this window.</p>
            ) : (
                report.map((d) => (
                    <section key={`${d.crewId}|${d.date}`} className="grid gap-3 border border-foreground/15 rounded-lg p-4">
                        <h2 className="m-0 text-lg font-bold">
                            {d.crewLabel} <span className="font-normal text-foreground/60">{d.date}</span>
                            <span className="ml-2 text-xs font-normal text-foreground/50">{d.recordings === 0 ? "no recording" : `${d.recordings} recording${d.recordings === 1 ? "" : "s"}`}</span>
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <PersonList title="Both" people={d.both} tone="text-foreground/60" />
                            <PersonList title="Recording only" people={d.recordingOnly} tone="text-tomato-readable" onRemove={(p) => remove(d, p)} />
                            <PersonList title="Sheet only" people={d.sheetOnly} tone="text-foreground/80" />
                            <PersonList title="Added by hand" people={d.manual} tone="text-foreground/60" onRemove={(p) => remove(d, p)} />
                        </div>
                    </section>
                ))
            )}

            <section className="grid gap-2">
                <h2 className="m-0 text-lg font-bold">Recent edits</h2>
                {edits.length === 0 ? (
                    <p className="m-0 text-sm text-foreground/50">No edits yet.</p>
                ) : (
                    <ul className="m-0 p-0 list-none grid gap-1 text-sm">
                        {edits.map((e) => (
                            <li key={e.id}>
                                {e.at.slice(0, 16).replace("T", " ")} UTC: {e.actorId} {e.action === "add" ? "added" : "removed"} {e.discordId} ({e.crewId}, {e.date})
                                {e.source ? ` [${e.source}]` : ""}
                                {e.reason ? `: ${e.reason}` : ""}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
