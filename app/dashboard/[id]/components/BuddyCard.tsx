// app/dashboard/[id]/components/BuddyCard.tsx
//
// Buddy card (plans/buddy-system.md, phase 1). Reads /api/buddy/me, which answers { enabled: false }
// while the setting buddy.enabled is off, so with the setting off this renders nothing. Shows the
// opt-in for members at the minimum level, and, for a buddy or a trainee, the pair with its checklist.

"use client";

import { completedLevel } from "@/app/lib/level-display";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface ChecklistItem { key: string; label: string; done: boolean }
interface PairCard {
    id: string;
    role: "buddy" | "trainee";
    status: string;
    partner: { discordId: string; name: string };
    threadUrl: string | null;
    waitingForAccess?: boolean;
    checklist: ChecklistItem[];
}
interface BuddyState {
    enabled: boolean;
    eligible?: boolean;
    belowMinLevel?: boolean;
    minLevel?: number;
    maxActiveCap?: number;
    profile?: { active: boolean; paused: boolean; maxActive: number; hideRecognition?: boolean } | null;
    recognitionEnabled?: boolean;
    traineeRecognition?: { pairId: string; buddyName: string; hidden: boolean } | null;
    pairs?: PairCard[];
}

export function BuddyCard({ initial }: { initial?: BuddyState | null }) {
    const t = useTranslations("buddyCard");
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
            if (!res.ok) setError(res.status === 403 ? t("notLevel") : t("saveFailed"));
            await load();
        } catch {
            setError(t("saveFailed"));
        } finally {
            setBusy(false);
        }
    }

    // The card appears after /api/buddy/me answers, so the browser's own #buddy jump has nothing to land
    // on yet: scroll to it once it renders.
    const rendered = !!state?.enabled;
    useEffect(() => {
        if (rendered && typeof window !== "undefined" && window.location.hash === "#buddy") {
            document.getElementById("buddy")?.scrollIntoView({ block: "start" });
        }
    }, [rendered]);

    if (!state?.enabled) return null;
    const pairs = state.pairs ?? [];
    const profile = state.profile;
    const showOptIn = (state.eligible && !profile?.active) || profile?.active;
    const tr = state.recognitionEnabled ? state.traineeRecognition : null;
    // Below the minimum level: still render a short note so a #buddy link does not land on nothing.
    const locked = !!state.belowMinLevel && !profile?.active && pairs.length === 0 && !tr && typeof state.minLevel === "number";
    if (!showOptIn && pairs.length === 0 && !tr && !locked) return null;

    return (
        <section id="buddy" data-testid="buddy-card" className="my-5 scroll-mt-24 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5" aria-label={t("title")}>
            <p className="overline">{t("title")}</p>
            {pairs.map((p) => (
                <div key={p.id} className="mt-3">
                    <h2 className="font-display text-xl font-bold">
                        {p.role === "trainee" ? t("yourBuddy", { name: p.partner.name }) : t("buddying", { name: p.partner.name })}
                    </h2>
                    {p.status === "COMPLETED" ? <p className="mt-1 text-sm text-foreground/80">{t("allDone")}</p> : null}
                    {p.waitingForAccess ? <p className="mt-1 text-sm text-foreground/80">{t("waiting")}</p> : null}
                    {p.threadUrl ? (
                        <a href={p.threadUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold underline-offset-4 hover:underline">
                            {t("openThread")}
                        </a>
                    ) : null}
                    <ul className="mt-2 grid gap-1 p-0" style={{ listStyle: "none" }}>
                        {p.checklist.map((item) => (
                            <li key={item.key} className="text-sm">
                                <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
                                <span className={item.done ? "text-foreground/60 line-through" : ""}>{item.label}</span>
                                <span className="sr-only">{item.done ? t("done") : t("notYet")}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {locked ? <p className="mt-3 text-sm text-foreground/80">{t("locked", { level: completedLevel(state.minLevel ?? 0) })}</p> : null}
            {state.eligible && !profile?.active ? (
                <div className="mt-3">
                    <p className="text-sm text-foreground/80">{t("invite")}</p>
                    <button type="button" disabled={busy} onClick={() => save({ active: true })} className="mt-2 rounded-full border border-foreground px-4 py-1.5 text-sm font-semibold">
                        {t("beBuddy")}
                    </button>
                </div>
            ) : null}
            {tr ? (
                <label className="mt-4 flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={busy} checked={!tr.hidden} onChange={(e) => save({ hideRecognition: !e.target.checked, pairId: tr.pairId })} />
                    {t("showTrainee", { name: tr.buddyName })}
                </label>
            ) : null}
            {state.recognitionEnabled && profile ? (
                <label className="mt-4 flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={busy} checked={!profile.hideRecognition} onChange={(e) => save({ hideRecognition: !e.target.checked })} />
                    {t("showBuddy")}
                </label>
            ) : null}
            {profile?.active ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                    <span>{profile.paused ? t("isBuddyPaused") : t("isBuddy")}</span>
                    <button type="button" disabled={busy} onClick={() => save({ paused: !profile.paused })} className="rounded-full border border-foreground/40 px-3 py-1 font-semibold">
                        {profile.paused ? t("resume") : t("pause")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => save({ active: false })} className="rounded-full border border-foreground/40 px-3 py-1 font-semibold">
                        {t("stop")}
                    </button>
                </div>
            ) : null}
            {error ? <p role="alert" className="mt-2 text-sm">{error}</p> : null}
        </section>
    );
}
