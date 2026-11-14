// app/dashboard/[id]/components/BuddyCard.tsx
//
// Buddy card (plans/buddy-system.md, phase 1). Reads /api/buddy/me, which answers { enabled: false }
// while the setting buddy.enabled is off, so with the setting off this renders nothing. Shows the
// opt-in for members at the minimum level, and, for a buddy or a trainee, the pair with its checklist.

"use client";

import { useCallback, useEffect, useState } from "react";

interface ChecklistItem { key: string; label: string; done: boolean }
interface PairCard {
    id: string;
    role: "buddy" | "trainee";
    status: string;
    partner: { discordId: string; name: string };
    threadUrl: string | null;
    checklist: ChecklistItem[];
}
interface BuddyState {
    enabled: boolean;
    eligible?: boolean;
    minLevel?: number;
    maxActiveCap?: number;
    profile?: { active: boolean; paused: boolean; maxActive: number } | null;
    pairs?: PairCard[];
}

export function BuddyCard({ initial }: { initial?: BuddyState | null }) {
    const [state, setState] = useState<BuddyState | null>(initial ?? null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/buddy/me", { cache: "no-store" });
            if (res.ok) setState((await res.json()) as BuddyState);
        } catch {
            /* the card simply stays hidden */
        }
    }, []);
    useEffect(() => {
        if (!initial) void load();
    }, [initial, load]);

    async function save(body: Record<string, unknown>) {
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/buddy/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (!res.ok) setError(res.status === 403 ? "You are not at the level to be a buddy yet." : "Could not save. Please try again.");
            await load();
        } catch {
            setError("Could not save. Please try again.");
        } finally {
            setBusy(false);
        }
    }

    if (!state?.enabled) return null;
    const pairs = state.pairs ?? [];
    const profile = state.profile;
    const showOptIn = (state.eligible && !profile?.active) || profile?.active;
    if (!showOptIn && pairs.length === 0) return null;

    return (
        <section data-testid="buddy-card" className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5" aria-label="Buddy">
            <p className="overline">Buddy</p>
            {pairs.map((p) => (
                <div key={p.id} className="mt-3">
                    <h2 className="font-display text-xl font-bold">
                        {p.role === "trainee" ? `Your buddy: ${p.partner.name}` : `You are buddying ${p.partner.name}`}
                    </h2>
                    {p.status === "COMPLETED" ? <p className="mt-1 text-sm text-foreground/80">All done. Thank you!</p> : null}
                    {p.threadUrl ? (
                        <a href={p.threadUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold underline-offset-4 hover:underline">
                            Open your thread on Discord
                        </a>
                    ) : null}
                    <ul className="mt-2 grid gap-1 p-0" style={{ listStyle: "none" }}>
                        {p.checklist.map((item) => (
                            <li key={item.key} className="text-sm">
                                <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
                                <span className={item.done ? "text-foreground/60 line-through" : ""}>{item.label}</span>
                                <span className="sr-only">{item.done ? " (done)" : " (not yet)"}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {state.eligible && !profile?.active ? (
                <div className="mt-3">
                    <p className="text-sm text-foreground/80">You can help a new member find their feet. Be a buddy: an admin pairs you with a trainee.</p>
                    <button type="button" disabled={busy} onClick={() => save({ active: true })} className="mt-2 rounded-full border border-foreground px-4 py-1.5 text-sm font-semibold">
                        Be a buddy
                    </button>
                </div>
            ) : null}
            {profile?.active ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                    <span>{profile.paused ? "You are a buddy (paused)." : "You are a buddy."}</span>
                    <button type="button" disabled={busy} onClick={() => save({ paused: !profile.paused })} className="rounded-full border border-foreground/40 px-3 py-1 font-semibold">
                        {profile.paused ? "Resume" : "Pause"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => save({ active: false })} className="rounded-full border border-foreground/40 px-3 py-1 font-semibold">
                        Stop being a buddy
                    </button>
                </div>
            ) : null}
            {error ? <p role="alert" className="mt-2 text-sm">{error}</p> : null}
        </section>
    );
}
