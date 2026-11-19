"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "APPROVED" | "PENDING" | "REJECTED" | "NOT_SUBMITTED";
interface PanelMission {
    missionId: number;
    level: number;
    title: string;
    status: Status;
    manual: boolean;
}

const LABEL: Record<Status, string> = {
    APPROVED: "Approved",
    PENDING: "Pending",
    REJECTED: "Rejected",
    NOT_SUBMITTED: "Not submitted",
};

/**
 * "Missions (admin)": reviewers mark a member's mission complete without a submission. Rendered only
 * for viewers whose session says they can review missions; the server decides what is returned
 * (per level) and re-checks every approval, so this is a convenience, not the gate.
 */
export function AdminMissionsPanel({ memberId }: { memberId: string }) {
    const [missions, setMissions] = useState<PanelMission[] | null>(null);
    const [open, setOpen] = useState<number | null>(null);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/missions/manual-approve?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" });
            if (!res.ok) return setMissions([]);
            const json = (await res.json()) as { missions?: PanelMission[] };
            setMissions(json.missions ?? []);
        } catch {
            setMissions([]);
        }
    }, [memberId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!missions || missions.length === 0) return null;

    const submit = async (missionId: number) => {
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/missions/manual-approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId, missionId, note }),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string; alreadyApproved?: boolean };
            if (!res.ok) {
                setMsg(json.error || "Could not mark complete");
            } else {
                setMsg(json.alreadyApproved ? "Already approved" : "Marked complete");
                setOpen(null);
                setNote("");
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const levels = [...new Set(missions.map((m) => m.level))];

    return (
        <section
            className="paper-soft rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
            }}
        >
            <p className="overline text-tomato mb-1">§ Missions (admin)</p>
            <p className="text-sm text-foreground/60 m-0 mb-3">
                Mark a mission complete without a submission. A note is required and is logged with your name. Rewards pay as usual.
            </p>
            {msg && <p role="status" className="text-sm m-0 mb-3">{msg}</p>}
            {levels.map((level) => (
                <div key={level} className="mb-4">
                    <p className="overline text-foreground/55 mb-1">Level {level}</p>
                    <ul className="m-0 p-0 list-none grid gap-2">
                        {missions
                            .filter((m) => m.level === level)
                            .map((m) => (
                                <li key={m.missionId} className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="min-w-0 text-sm">{m.title}</span>
                                        <span className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-foreground/60">
                                                {LABEL[m.status]}
                                                {m.manual ? " (manual)" : ""}
                                            </span>
                                            {m.status !== "APPROVED" && (
                                                <button
                                                    type="button"
                                                    className="btn-pill text-xs"
                                                    onClick={() => {
                                                        setOpen(open === m.missionId ? null : m.missionId);
                                                        setNote("");
                                                        setMsg(null);
                                                    }}
                                                >
                                                    Mark complete
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                    {open === m.missionId && (
                                        <div className="grid gap-2">
                                            <textarea
                                                value={note}
                                                onChange={(e) => setNote(e.target.value)}
                                                maxLength={500}
                                                rows={2}
                                                placeholder="Required note: why is this complete?"
                                                aria-label="Note"
                                                className="w-full rounded-md border p-2 text-sm bg-transparent"
                                            />
                                            <button
                                                type="button"
                                                className="btn-pill text-xs self-start"
                                                disabled={busy || note.trim().length < 3}
                                                onClick={() => void submit(m.missionId)}
                                            >
                                                {busy ? "Saving..." : "Confirm"}
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                    </ul>
                </div>
            ))}
        </section>
    );
}
