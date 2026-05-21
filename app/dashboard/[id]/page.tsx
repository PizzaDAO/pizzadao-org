// app/dashboard/[id]/page.tsx
//
// Plan: plans/garlic-96648-dashboard-redesign.md — PR5 (slice-61816).
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
import { PepIcon, SendPepModal } from "../../ui/economy";
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
const FONT_DISPLAY = "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
    // The BFF (`useDashboardSummary`) collapses the previous 8 child queries
    // into one request. The individual hooks below remain as a fallback while
    // the summary is loading or if it errors — same data, just slower.
    const { data: summary } = useDashboardSummary(id);
    const { data: activity } = useActivity(id);
    const { data: userData, isLoading: userDataLoading, error: userDataError } = useUserData(id);
    const { data: pfpData } = usePfp(id);
    const { data: crewMappingsData } = useCrewMappings();
    const { data: tasksData } = useMyTasks(id);
    const { data: balanceData } = useMyBalance();
    // Shared cache with MissionsProgress — no double-fetch.
    const { data: missionsData } = useMissions();
    // PR4 — Discover section (replaces the slim nav row). Single hook,
    // parallel fetches with per-source fallbacks; safe to render any time.
    const { data: discoverData } = useDiscover();

    // Derive auth/loading/error from the useUserData hook
    const loading = userDataLoading;
    const authError = userDataError?.message === '__AUTH_401__'
        ? "Please log in to view your dashboard"
        : userDataError?.message === '__AUTH_403__'
        ? "You don't have permission to view this dashboard"
        : null;
    const error = userDataError && !authError ? userDataError.message : null;

    // Local mutable state for data (save handlers update it optimistically)
    const [data, setData] = useState<any>(null);
    useEffect(() => {
        if (userData) setData(userData);
    }, [userData]);

    // Derived data — prefer the summary payload when present, fall back to
    // the individual hooks. Visual output is identical either way.
    const pfpUrl = summary?.member?.pfpUrl ?? pfpData?.url ?? null;
    const pepBalance = summary?.pep?.balance ?? balanceData?.balance ?? null;
    const myTasks = tasksData?.tasksByCrew ?? {};
    const doneCounts = tasksData?.doneCountsByCrew ?? {};
    const hydratedCrews = summary?.crewsHydrated;

    // Mission level for hero header — sourced from the BFF summary when
    // available, otherwise from the shared `useMissions` query.
    const missionLevel = summary?.level?.current != null
        ? { level: summary.level.current as number, title: (summary.level.title as string) || "" }
        : missionsData?.currentLevel != null
            ? { level: missionsData.currentLevel as number, title: (missionsData.levelTitle as string) || "" }
            : null;

    // Crew options: derived from hook data with fallback to static CREWS
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
        // Fallback to static CREWS
        return (CREWS ?? []).map((c: any) => ({
            id: String(c.id),
            label: String(c.label ?? c.id),
            turtles: [] as string[],
        }));
    })();

    // --- UI-only state ---
    // Editing surfaces (orgs/skills/X) moved to /profile/[id]/edit in PR5.
    // Wallets moved to /me/wallets. Only `showSendModal` remains here.
    const [showSendModal, setShowSendModal] = useState(false);

    if (loading) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
            }}>
                <div style={{ textAlign: "center" }}>
                    <div className="spinner" style={{
                        width: 50,
                        height: 50,
                        border: '4px solid hsl(var(--ink) / 0.10)',
                        borderTop: '4px solid hsl(var(--tomato))',
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto 20px"
                    }} />
                    <p style={{ fontSize: 18, color: "hsl(var(--muted-foreground))", fontFamily: FONT_DISPLAY, fontWeight: 600 }}>Loading your Mafia stats...</p>
                    <style jsx>{`
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          `}</style>
                </div>
            </div>
        );
    }

    if (authError) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
                padding: 20
            }}>
                <div style={card()}>
                    <h1 style={{ fontSize: 28, marginBottom: 16, fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: "-0.01em" }}>Access Denied</h1>
                    <p style={{ color: "hsl(var(--muted-foreground))", marginBottom: 32 }}>{authError}</p>
                    <Link href="/" style={btn("primary")}>
                        Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
                padding: 20
            }}>
                <div style={card()}>
                    <h1 style={{ fontSize: 28, marginBottom: 16, fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: "-0.01em" }}>Oops!</h1>
                    <p style={{ color: "hsl(var(--muted-foreground))", marginBottom: 32 }}>{error || "We couldn't find your data. Are you sure you're in the Crew yet?"}</p>
                    <Link href="/" style={btn("primary")}>
                        Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    const name = data["Name"] || data["Mafia Name"] || "Anonymous Pizza Maker";
    const city = data["City"] || "Worldwide";
    const idValue = data["ID"] || data["Crew ID"] || id;
    const crewsStr = data["Crews"] || "None";

    // Parse users crews
    const userCrews = (crewsStr !== "None" ? crewsStr.split(",").map((c: string) => c.trim()).filter(Boolean) : []) as string[];

    // Suppress the unused-data setter warning. `setData` is still imported
    // because future editors mutate the cached row optimistically; nothing
    // currently writes through it post-PR5.
    void setData;

    return (
        <div style={{
            minHeight: "100vh",
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontFamily: FONT_SANS,
            // sicilian-41551: shrink horizontal gutter on small screens so the
            // 24px card padding inside doesn't eat too much usable width at 375px.
            padding: "clamp(24px, 6vw, 40px) clamp(12px, 4vw, 20px)",
        }}>
            <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
                {/* Main Card */}
                <div style={card()}>

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

                    {/* ── 1.5. Next Action (PR3 — above the fold) ── */}
                    {summary?.nextAction && (
                        <NextActionPanel nextAction={summary.nextAction} />
                    )}

                    {/* ── 2. Discover (PR4 — replaces slim nav) ── */}
                    <Discover
                        bounties={discoverData?.bounties}
                        jobs={discoverData?.jobs}
                        articles={discoverData?.articles}
                        calls={discoverData?.calls}
                    />

                    {/* ── 3. Missions Progress ── */}
                    <div style={{ paddingTop: 10, borderTop: '1px solid hsl(var(--rule) / 0.12)' }}>
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

                    {/* ── 4.5. Recent Activity (PR3 — last 5 events) ── */}
                    <RecentActivity events={(activity?.events ?? []).slice(0, 5)} />

                    {/* ── 5. Vouches Widget ── */}
                    <div style={{ paddingTop: 10, borderTop: '1px solid hsl(var(--rule) / 0.12)' }}>
                        <VouchesWidget memberId={idValue} />
                    </div>

                    {/* Identity (Profile Details) + Collections moved out in PR5:
                          - /profile/[id]/edit   (orgs, skills, X, socials, links, tagline)
                          - /me/wallets         (wallet management) */}

                    {/* ── 6. Logout ── */}
                    <div style={{ paddingTop: 16, borderTop: '1px solid hsl(var(--rule) / 0.12)', textAlign: "center" }}>
                        <button
                            onClick={async () => {
                                try {
                                    // Clear localStorage
                                    localStorage.removeItem("mob_pizza_onboarding_v3");
                                    localStorage.removeItem("mob_pizza_onboarding_pending_claim_v1");
                                } catch { }
                                try {
                                    // Clear session cookie via API
                                    await fetch("/api/logout", { method: "POST" });
                                } catch { }
                                // Redirect to home
                                router.push("/");
                            }}
                            style={{
                                ...btn("secondary"),
                                fontFamily: "inherit",
                                fontSize: 16
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </div>

                {/* Footer info */}
                <div style={{
                    textAlign: "center",
                    marginTop: 40,
                    fontSize: 12,
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                }}>
                    PizzaDAO
                </div>
            </div>

            {/* Send PEP Modal — extracted to app/ui/economy/SendPepModal.tsx */}
            <SendPepModal
                open={showSendModal}
                onClose={() => setShowSendModal(false)}
                currentMemberId={idValue}
            />
        </div>
    );
}

// --- Local style helpers — consume Phase 1 HSL tokens directly. ---
// (Kept local rather than imported from shared-styles to preserve the slightly
// tighter card padding/radius this page has used historically.)

function card(): React.CSSProperties {
    return {
        border: '1px solid hsl(var(--rule) / 0.12)',
        borderRadius: "var(--radius)",
        // sicilian-41551: shrink card padding on phones so the inner content
        // keeps ~320px usable at the 375px viewport.
        padding: "clamp(16px, 4vw, 24px)",
        boxShadow: '0 8px 30px hsl(var(--ink) / 0.06)',
        background: 'hsl(var(--card))',
        color: 'hsl(var(--card-foreground))',
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary" | "accent"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // sicilian-41551: 44px mobile touch-target floor.
        minHeight: 44,
        padding: "10px 16px",
        borderRadius: "var(--radius)",
        border: '1px solid transparent',
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    };
    if (kind === "primary") {
        return {
            ...base,
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            borderColor: 'hsl(var(--primary))',
        };
    }
    if (kind === "accent") {
        return {
            ...base,
            background: 'hsl(var(--tomato))',
            color: 'hsl(var(--cream))',
            borderColor: 'hsl(var(--tomato))',
        };
    }
    return {
        ...base,
        background: 'hsl(var(--secondary))',
        color: 'hsl(var(--secondary-foreground))',
        borderColor: 'hsl(var(--rule) / 0.22)',
    };
}
