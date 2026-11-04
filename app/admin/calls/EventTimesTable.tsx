"use client";

// The configured crew call times. Discord is only read when the button is pressed (not on page load).

import { useState } from "react";

interface Row {
    eventId: string;
    label: string;
    localTime: string;
    timeZone: string;
}
interface Live {
    startMs: number | null;
    localNow: { year: number; month: number; day: number; hour: number; minute: number } | null;
    driftMin: number | null;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function EventTimesTable({ rows }: { rows: Row[] }) {
    const [live, setLive] = useState<Record<string, Live> | null>(null);
    const [state, setState] = useState<"idle" | "loading" | "error">("idle");

    async function check() {
        setState("loading");
        try {
            const res = await fetch("/api/admin/calls/event-times");
            const json = (await res.json().catch(() => null)) as { rows?: Array<Live & { eventId: string }> } | null;
            if (!res.ok || !json?.rows) return setState("error");
            setLive(Object.fromEntries(json.rows.map((r) => [r.eventId, r])));
            setState("idle");
        } catch {
            setState("error");
        }
    }

    return (
        <div className="grid gap-2">
            <div className="flex items-center gap-3">
                <button type="button" className="rounded-full border px-4 py-1.5 text-sm font-semibold" disabled={state === "loading"} onClick={check}>
                    {state === "loading" ? "Reading Discord..." : "Check against Discord"}
                </button>
                {state === "error" && <span className="text-sm text-tomato">Could not read Discord.</span>}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left">
                            <th className="pr-3">Crew</th>
                            <th className="pr-3">Intended</th>
                            <th className="pr-3">Next start in Discord (UTC)</th>
                            <th className="pr-3">Next start (local)</th>
                            <th>Drift</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => {
                            const l = live?.[r.eventId];
                            const w = l?.localNow;
                            return (
                                <tr key={r.eventId}>
                                    <td className="pr-3">{r.label || r.eventId}</td>
                                    <td className="pr-3">
                                        {r.localTime} {r.timeZone}
                                    </td>
                                    <td className="pr-3">
                                        {live === null ? "" : l?.startMs != null ? new Date(l.startMs).toISOString().slice(0, 16).replace("T", " ") : "event not found"}
                                    </td>
                                    <td className="pr-3">{w ? `${w.year}-${p2(w.month)}-${p2(w.day)} ${p2(w.hour)}:${p2(w.minute)}` : ""}</td>
                                    <td>{l?.driftMin == null ? "" : l.driftMin === 0 ? "none" : `${l.driftMin > 0 ? "+" : ""}${l.driftMin} min`}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
