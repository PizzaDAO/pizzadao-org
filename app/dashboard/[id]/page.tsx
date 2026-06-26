// app/dashboard/[id]/page.tsx
//
// Plan: plans/garlic-96648-dashboard-redesign.md — PR5 (slice-61816).
// tomato-30368 — Editorial restyle. Composition is unchanged (same hooks,
// same five sections, same modal); the chrome now follows the wizard's
// print-shop vocabulary — paper grain, warm rule dividers, fade-up
// entrance, overline section labels through the child components.
//
// After this PR the dashboard is *activity-only*. Identity-editing surfaces
// (orgs/skills/X/socials/links) live on /profile/[id]/edit; wallet management
// lives on /me/wallets. See `CollapsibleSection` removal and the two routes:
//
//   * app/profile/[id]/edit/page.tsx
//   * app/me/wallets/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CREWS } from "../../ui/constants";
import { SendPepModal } from "../../ui/economy";
import { MissionsProgress } from "../../ui/missions";
import { VouchesWidget } from "../../ui/vouches/VouchesWidget";
import {
    useUserData,
    usePfp,
    useCrewMappings,
    useMyTasks,
    useMyBalance,
    useMissions,
    useDashboardSummary,
    useActivity,
    useDiscover,
} from "../../lib/hooks/use-api";
import { HeroBlock } from "./components/HeroBlock";
import { YourCrews, type CrewOption } from "./components/YourCrews";
import { NextActionPanel } from "./components/NextActionPanel";
import { RecentActivity } from "./components/RecentActivity";
import { Discover } from "./components/Discover";

// Tokens: see app/globals.css. Body uses --font-sans (Asap), headings use
// --font-display (Asap Condensed). Colors via hsl(var(--<token>)).
const FONT_SANS = "var(--font-sans), system-ui, sans-serif";

function norm(s: unknown) {
    return String(s ?? "")
        .trim()
        .replace(/\s+/g, " ");
}

function splitTurtlesCell(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(norm).filter(Boolean);
    const s = norm(v);
    if (!s) return [];
    return s
        .split(/[,/|]+/)
        .map((x) => norm(x))
        .filter(Boolean);
}

export default function Dashboard({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    // --- React Query hooks for data fetching ---
    const { data: summary } = useDashboardSummary(id);
    const { data: activity } = useActivity(id);
    const { data: userData, isLoading: userDataLoading, error: userDataError } = useUserData(id);
    const { data: pfpData } = usePfp(id);
    const { data: crewMappingsData } = useCrewMappings();
    const { data: tasksData } = useMyTasks(id);
    const { data: balanceData } = useMyBalance();
    const { data: missionsData } = useMissions();
    const { data: discoverData } = useDiscover();

    const loading = userDataLoading;
    const authError = userDataError?.message === '__AUTH_401__'
        ? "Please log in to view your dashboard"
        : userDataError?.message === '__AUTH_403__'
        ? "You don't have permission to view this dashboard"
        : null;
    const error = userDataError && !authError ? userDataError.message : null;

    const [data, setData] = useState<any>(null);
    useEffect(() => {
        if (userData) setData(userData);
    }, [userData]);

    const pfpUrl = summary?.member?.pfpUrl ?? pfpData?.url ?? null;
    const pepBalance = summary?.pep?.balance ?? balanceData?.balance ?? null;
    const myTasks = tasksData?.tasksByCrew ?? {};
    const doneCounts = tasksData?.doneCountsByCrew ?? {};
    const hydratedCrews = summary?.crewsHydrated;

    const missionLevel = summary?.level?.current != null
        ? { level: summary.level.current as number, title: (summary.level.title as string) || "" }
        : missionsData?.currentLevel != null
            ? { level: missionsData.currentLevel as number, title: (missionsData.levelTitle as string) || "" }
            : null;

    const crewOptions: CrewOption[] = (() => {
        const crews = crewMappingsData?.crews;
        if (Array.isArray(crews) && crews.length > 0) {
            return crews
                .map((c: any) => ({
                    ...c,
                    id: String(c?.id ?? ""),
                    label: norm(c?.label ?? ""),
                    turtles: splitTurtlesCell(c?.turtles),
                    emoji: norm(c?.emoji) || undefined,
                    role: norm(c?.role) || undefined,
                    channel: norm(c?.channel) || undefined,
                    event: norm(c?.event) || undefined,
                    sheet: norm(c?.sheet) || undefined,
                    callTime: norm(c?.callTime) || undefined,
                    callTimeUrl: norm(c?.callTimeUrl) || undefined,
                    callLength: norm(c?.callLength) || undefined,
                    tasks: Array.isArray(c?.tasks) ? c.tasks : [],
                }))
                .filter((c: CrewOption) => c.id && c.label);
        }
        return (CREWS ?? []).map((c: any) => ({
            id: String(c.id),
            label: String(c.label ?? c.id),
            turtles: [] as string[],
        }));
    })();

    const [showSendModal, setShowSendModal] = useState(false);

    // ── Loading state ────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="relative grid min-h-screen place-items-center"
                style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: FONT_SANS, padding: "clamp(24px, 6vw, 40px)" }}>
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
                    style={{ background: "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.18), transparent 60%)" }}
                />
                <div className="fade-up text-center">
                    <p className="overline text-tomato">§ 00 · loading the file</p>
                    <div style={{ width: 50, height: 50, border: '3px solid hsl(var(--ink) / 0.10)', borderTop: '3px solid hsl(var(--tomato))', borderRadius: "50%", animation: "spin 1s linear infinite", margin: "20px auto" }} />
                    <p className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em]" style={{ fontSize: "clamp(1.5rem, 4vw, 2.2rem)", lineHeight: 1 }}>
                        Pulling the ledger&hellip;
                    </p>
                    <style jsx>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        );
    }

    // ── Error states ────────────────────────────────────────────────
    if (authError || error || !data) {
        const isAuth = !!authError;
        const headline = isAuth ? "Access denied" : "Something's off";
        const overline = isAuth ? "§ 00 · the door's locked" : "§ 00 · misfile";
        const body = isAuth ? authError : (error || "We couldn't find your file. Are you sure you're in the Family yet?");
        return (
            <div className="relative grid min-h-screen place-items-center"
                style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: FONT_SANS, padding: "clamp(24px, 6vw, 40px) clamp(16px, 4vw, 20px)" }}>
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
                    style={{ background: "radial-gradient(70% 60% at 50% 0%, hsl(0 93% 60% / 0.10), transparent 65%)" }}
                />
                <div className="paper-soft fade-up relative w-full max-w-lg rounded-[24px] border p-7 text-center md:p-10"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.55)", background: "hsl(var(--card))", boxShadow: "var(--shadow-soft)" }}>
                    <p className="overline relative text-tomato">{overline}</p>
                    <h1 className="font-[family-name:var(--font-display)] relative mt-3 font-black tracking-[-0.015em] text-foreground"
                        style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", lineHeight: 1 }}>
                        {headline}
                    </h1>
                    <p className="relative mt-4 text-foreground/70" style={{ fontSize: 15, lineHeight: 1.55 }}>{body}</p>
                    <div className="relative mt-6">
                        <Link href="/" className="btn-pill" style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))", textDecoration: "none" }}>
                            Back to home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const name = data["Name"] || data["Mafia Name"] || "Anonymous Pizza Maker";
    const city = data["City"] || "Worldwide";
    const idValue = data["ID"] || data["Crew ID"] || id;
    const crewsStr = data["Crews"] || "None";
    const userCrews = (crewsStr !== "None" ? crewsStr.split(",").map((c: string) => c.trim()).filter(Boolean) : []) as string[];

    // Suppress the unused-data setter warning. `setData` is still imported
    // because future editors mutate the cached row optimistically; nothing
    // currently writes through it post-PR5.
    void setData;

    return (
        <div className="relative" style={{
            minHeight: "100vh",
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontFamily: FONT_SANS,
            padding: "clamp(24px, 6vw, 40px) clamp(12px, 4vw, 20px)",
        }}>
            {/* Page-wide warm spotlight */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70svh] opacity-50"
                style={{
                    background:
                        "radial-gradient(60% 50% at 15% 0%, hsl(46 100% 62% / 0.16), transparent 60%), radial-gradient(60% 60% at 95% 8%, hsl(0 93% 60% / 0.06), transparent 65%)",
                }}
            />

            <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 24 }}>
                {/* Main editorial surface */}
                <div
                    className="paper-soft fade-up relative overflow-hidden rounded-[28px] border"
                    style={{
                        borderColor: "hsl(var(--rule-warm) / 0.55)",
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                        boxShadow: "var(--shadow-soft)",
                        padding: "clamp(20px, 4vw, 36px)",
                        display: "grid",
                        gap: 6,
                    }}
                >
                    {/* ── 1. Compact Hero Header ── */}
                    <HeroBlock
                        name={name}
                        pfpUrl={pfpUrl}
                        levelBadge={missionLevel}
                        pepBalance={pepBalance}
                        city={city}
                        idValue={idValue}
                        missionLevel={missionLevel}
                        onSendPep={() => setShowSendModal(true)}
                    />

                    {/* ── 1.5. Next Action ── */}
                    {summary?.nextAction && (
                        <NextActionPanel nextAction={summary.nextAction} />
                    )}

                    {/* ── 2. Discover ── */}
                    <Discover
                        bounties={discoverData?.bounties}
                        jobs={discoverData?.jobs}
                        articles={discoverData?.articles}
                        calls={discoverData?.calls}
                    />

                    {/* ── 3. Missions Progress ── */}
                    <div className="rule-warm" style={{ paddingTop: 24 }}>
                        <MissionsProgress summary={missionsData} />
                    </div>

                    {/* ── 4. Your Crews ── */}
                    <YourCrews
                        crewOptions={crewOptions}
                        userCrews={userCrews}
                        myTasks={myTasks}
                        doneCounts={doneCounts}
                        currentMemberId={idValue}
                        hydratedCrews={hydratedCrews}
                    />

                    {/* ── 4.5. Recent Activity ── */}
                    <RecentActivity events={(activity?.events ?? []).slice(0, 5)} />

                    {/* ── 5. Vouches Widget ── */}
                    <div className="rule-warm" style={{ paddingTop: 24 }}>
                        <VouchesWidget memberId={idValue} />
                    </div>

                    {/* ── 6. Logout ── */}
                    <div className="rule-warm" style={{ paddingTop: 24, textAlign: "center" }}>
                        <button
                            onClick={async () => {
                                try {
                                    localStorage.removeItem("mob_pizza_onboarding_v3");
                                    localStorage.removeItem("mob_pizza_onboarding_pending_claim_v1");
                                } catch { }
                                try {
                                    await fetch("/api/logout", { method: "POST" });
                                } catch { }
                                router.push("/");
                            }}
                            className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
                            style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                textDecoration: "underline",
                                textUnderlineOffset: 4,
                                padding: 8,
                            }}
                        >
                            Step out · log out
                        </button>
                    </div>
                </div>

                {/* Footer mark */}
                <div className="text-center">
                    <p className="overline text-foreground/40">§ pizzadao · est. 2021</p>
                </div>
            </div>

            {/* Send PEP Modal */}
            <SendPepModal
                open={showSendModal}
                onClose={() => setShowSendModal(false)}
                currentMemberId={idValue}
            />
        </div>
    );
}
