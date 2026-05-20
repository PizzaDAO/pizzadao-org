// app/dashboard/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { TURTLES, CREWS } from "../../ui/constants";
import { SendPepModal } from "../../ui/economy";
import { NFTCollection } from "../../ui/nft";
import { POAPCollection } from "../../ui/poap";
import { ProfileLinksEditor } from "../../ui/profile-links";
import { MissionsProgress } from "../../ui/missions";
import { UnlockTicketCard } from "../../ui/unlock-ticket-card";
import { WalletManager } from "../../ui/wallet-manager/WalletManager";
import { VouchesWidget } from "../../ui/vouches/VouchesWidget";
import { SocialAccountLinker } from "../../ui/vouches/SocialAccountLinker";
import {
    useUserData,
    usePfp,
    useXAccount,
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
    const { data: xAccountData } = useXAccount(id);
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

    // X account: local state because disconnect handler mutates it
    const [xAccount, setXAccount] = useState<{ connected: boolean; username?: string; displayName?: string } | null>(null);
    useEffect(() => {
        if (xAccountData) setXAccount(xAccountData);
    }, [xAccountData]);

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

    // --- UI-only state (not data fetching) ---
    const [editingSkills, setEditingSkills] = useState(false);
    const [skillsInput, setSkillsInput] = useState("");
    const [skillsSaving, setSkillsSaving] = useState(false);
    const [editingOrgs, setEditingOrgs] = useState(false);
    const [orgsInput, setOrgsInput] = useState("");
    const [orgsSaving, setOrgsSaving] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [xDisconnecting, setXDisconnecting] = useState(false);

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
    const discord = data["DiscordID"] || data["Discord"] || "Not linked";
    const status = data["Status"] || data["Frequency"] || "No status";
    const orgs = data["Orgs"] || "None";
    const skills = data["Skills"] || "None";
    const telegram = data["Telegram"] || "Not linked";

    // Parse turtles
    const rawTurtles = data["Turtles"] || data["Roles"] || [];
    const turtleList = (Array.isArray(rawTurtles) ? rawTurtles : String(rawTurtles).split(",").map(t => t.trim())).filter(Boolean);

    // Parse users crews
    const userCrews = (crewsStr !== "None" ? crewsStr.split(",").map((c: string) => c.trim()).filter(Boolean) : []) as string[];

    return (
        <div style={{
            minHeight: "100vh",
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontFamily: FONT_SANS,
            padding: "40px 20px"
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

                    {/* ── 6. Collapsible "Profile Details" ── */}
                    <CollapsibleSection title="Profile Details">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                            <StatItem label="Status" value={status} />

                            {/* Orgs with edit button */}
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                    <h3 style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        color: "hsl(var(--muted-foreground))",
                                        margin: 0,
                                        fontWeight: 700,
                                        fontFamily: FONT_DISPLAY,
                                    }}>
                                        Orgs
                                    </h3>
                                    {!editingOrgs && (
                                        <button
                                            onClick={() => {
                                                setOrgsInput(orgs === "None" ? "" : orgs);
                                                setEditingOrgs(true);
                                            }}
                                            style={{
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                opacity: 0.4,
                                                padding: 0,
                                                display: "flex",
                                                alignItems: "center"
                                            }}
                                            title="Edit orgs"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    )}
                                </div>
                                {editingOrgs ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <textarea
                                            value={orgsInput}
                                            onChange={(e) => setOrgsInput(e.target.value)}
                                            placeholder="Enter your orgs (comma separated)"
                                            style={{
                                                padding: 8,
                                                borderRadius: 6,
                                                border: '1px solid hsl(var(--rule) / 0.22)',
                                                fontSize: 14,
                                                fontFamily: "inherit",
                                                resize: "vertical",
                                                minHeight: 60
                                            }}
                                        />
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button
                                                onClick={async () => {
                                                    setOrgsSaving(true);
                                                    try {
                                                        const res = await fetch("/api/update-orgs", {
                                                            method: "POST",
                                                            headers: { "Content-Type": "application/json" },
                                                            body: JSON.stringify({ memberId: idValue, orgs: orgsInput })
                                                        });
                                                        if (res.ok) {
                                                            setData({ ...data, Orgs: orgsInput });
                                                            setEditingOrgs(false);
                                                        } else {
                                                            const err = await res.json();
                                                            alert(err.error || "Failed to save");
                                                        }
                                                    } catch (e) {
                                                        alert("Failed to save orgs");
                                                    } finally {
                                                        setOrgsSaving(false);
                                                    }
                                                }}
                                                disabled={orgsSaving}
                                                style={{
                                                    ...btn("primary"),
                                                    fontSize: 12,
                                                    padding: "6px 12px"
                                                }}
                                            >
                                                {orgsSaving ? "Saving..." : "Save"}
                                            </button>
                                            <button
                                                onClick={() => setEditingOrgs(false)}
                                                style={{
                                                    ...btn("secondary"),
                                                    fontSize: 12,
                                                    padding: "6px 12px"
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{
                                        fontSize: 18,
                                        fontWeight: 500,
                                        color: 'hsl(var(--foreground))',
                                        margin: 0,
                                        wordBreak: "break-word"
                                    }}>
                                        {orgs}
                                    </p>
                                )}
                            </div>

                            {/* Skills with edit button */}
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                    <h3 style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        color: "hsl(var(--muted-foreground))",
                                        margin: 0,
                                        fontWeight: 700,
                                        fontFamily: FONT_DISPLAY,
                                    }}>
                                        Skills
                                    </h3>
                                    {!editingSkills && (
                                        <button
                                            onClick={() => {
                                                setSkillsInput(skills === "None" ? "" : skills);
                                                setEditingSkills(true);
                                            }}
                                            style={{
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                opacity: 0.4,
                                                padding: 0,
                                                display: "flex",
                                                alignItems: "center"
                                            }}
                                            title="Edit skills"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    )}
                                </div>
                                {editingSkills ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <textarea
                                            value={skillsInput}
                                            onChange={(e) => setSkillsInput(e.target.value)}
                                            placeholder="Enter your skills (comma separated)"
                                            style={{
                                                padding: 8,
                                                borderRadius: 6,
                                                border: '1px solid hsl(var(--rule) / 0.22)',
                                                fontSize: 14,
                                                fontFamily: "inherit",
                                                resize: "vertical",
                                                minHeight: 60
                                            }}
                                        />
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button
                                                onClick={async () => {
                                                    setSkillsSaving(true);
                                                    try {
                                                        const res = await fetch("/api/update-skills", {
                                                            method: "POST",
                                                            headers: { "Content-Type": "application/json" },
                                                            body: JSON.stringify({ memberId: idValue, skills: skillsInput })
                                                        });
                                                        if (res.ok) {
                                                            setData({ ...data, Skills: skillsInput });
                                                            setEditingSkills(false);
                                                        } else {
                                                            const err = await res.json();
                                                            alert(err.error || "Failed to save");
                                                        }
                                                    } catch (e) {
                                                        alert("Failed to save skills");
                                                    } finally {
                                                        setSkillsSaving(false);
                                                    }
                                                }}
                                                disabled={skillsSaving}
                                                style={{
                                                    ...btn("primary"),
                                                    fontSize: 12,
                                                    padding: "6px 12px"
                                                }}
                                            >
                                                {skillsSaving ? "Saving..." : "Save"}
                                            </button>
                                            <button
                                                onClick={() => setEditingSkills(false)}
                                                style={{
                                                    ...btn("secondary"),
                                                    fontSize: 12,
                                                    padding: "6px 12px"
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{
                                        fontSize: 18,
                                        fontWeight: 500,
                                        color: 'hsl(var(--foreground))',
                                        margin: 0,
                                        wordBreak: "break-word"
                                    }}>
                                        {skills}
                                    </p>
                                )}
                            </div>

                            <StatItem label="Discord" value={discord} />
                            <StatItem label="Telegram" value={telegram} />

                            {/* Roles */}
                            <div style={{ gridColumn: "1 / -1" }}>
                                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                                    <div>
                                        <h3 style={{
                                            fontSize: 11,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.08em",
                                            color: "hsl(var(--muted-foreground))",
                                            marginTop: 0,
                                            marginBottom: 6,
                                            fontWeight: 700,
                                            fontFamily: FONT_DISPLAY,
                                        }}>
                                            Roles
                                        </h3>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                            {turtleList.length > 0 ? (
                                                turtleList.map((tName: string) => {
                                                    const tDef = TURTLES.find(t => t.id.toLowerCase() === tName.toLowerCase() || t.label.toLowerCase() === tName.toLowerCase());
                                                    if (!tDef) return null;
                                                    return (
                                                        <img
                                                            key={tDef.id}
                                                            src={tDef.image}
                                                            alt={tDef.label}
                                                            title={tDef.label}
                                                            style={{ width: 40, height: 40, objectFit: "contain" }}
                                                        />
                                                    );
                                                })
                                            ) : (
                                                <span style={{ fontSize: 18, fontWeight: 500, opacity: 0.5 }}>None</span>
                                            )}
                                        </div>

                                        {/* Other Roles List */}
                                        {(() => {
                                            const otherRoles = turtleList.filter((tName: string) => {
                                                return !TURTLES.find(t => t.id.toLowerCase() === tName.toLowerCase() || t.label.toLowerCase() === tName.toLowerCase());
                                            });

                                            if (otherRoles.length === 0) return null;
                                            return (
                                                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
                                                    <strong>Other Roles:</strong> {otherRoles.join(", ")}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Profile Links - editable */}
                            <ProfileLinksEditor memberId={idValue} />

                            {/* Connect X Account */}
                            <div style={{
                                gridColumn: "1 / -1",
                                padding: 16,
                                borderRadius: 12,
                                border: '1px solid hsl(var(--rule) / 0.12)',
                                background: 'hsl(var(--card))',
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                            }}>
                                {/* X Logo */}
                                <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>

                                {xAccount?.connected ? (
                                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                                        <div>
                                            <a
                                                href={`https://x.com/${xAccount.username}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                style={{
                                                    fontWeight: 600,
                                                    fontSize: 16,
                                                    color: 'hsl(var(--foreground))',
                                                    textDecoration: "none",
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                                                onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                                            >
                                                @{xAccount.username}
                                            </a>
                                            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Connected</div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setXDisconnecting(true);
                                                try {
                                                    const res = await fetch("/api/x/disconnect", { method: "DELETE" });
                                                    if (res.ok) {
                                                        setXAccount({ connected: false });
                                                    }
                                                } catch {} finally {
                                                    setXDisconnecting(false);
                                                }
                                            }}
                                            disabled={xDisconnecting}
                                            style={{
                                                background: "transparent",
                                                border: '1px solid hsl(var(--rule) / 0.22)',
                                                borderRadius: 8,
                                                padding: "6px 12px",
                                                fontSize: 12,
                                                cursor: "pointer",
                                                opacity: xDisconnecting ? 0.5 : 0.7,
                                                fontFamily: "inherit",
                                                color: 'hsl(var(--foreground))',
                                            }}
                                        >
                                            {xDisconnecting ? "Disconnecting..." : "Disconnect"}
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                                        <span style={{ fontSize: 14, opacity: 0.6 }}>Connect your X account</span>
                                        <a
                                            href={`/api/x/login?memberId=${idValue}`}
                                            style={{
                                                ...btn("primary"),
                                                fontSize: 13,
                                                padding: "8px 16px",
                                                textDecoration: "none",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 6,
                                            }}
                                        >
                                            Connect X
                                        </a>
                                    </div>
                                )}
                            </div>

                            {/* Social Accounts - link X and Farcaster handles */}
                            <SocialAccountLinker memberId={idValue} />
                        </div>
                    </CollapsibleSection>

                    {/* ── 7. Collapsible "Collections" ── */}
                    <CollapsibleSection title="Collections">
                        <div style={{ display: "grid", gap: 14 }}>
                            <WalletManager memberId={idValue} />
                            <POAPCollection memberId={idValue} />
                            <NFTCollection memberId={idValue} showConnectPrompt={false} />
                            <UnlockTicketCard memberId={idValue} />
                        </div>
                    </CollapsibleSection>

                    {/* ── 8. Logout ── */}
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

// NOTE: This local `CollapsibleSection` is intentionally NOT swapped for the
// shared `app/ui/shared/CollapsibleSection.tsx` extracted by sibling PR
// (capers-23453, PR #72). A follow-up PR after that one merges will switch
// dashboard to the shared component. Until then, this preserves visual parity.
function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ paddingTop: 10, borderTop: '1px solid hsl(var(--rule) / 0.12)' }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 0,
                    width: "100%",
                    textAlign: "left",
                    color: 'hsl(var(--foreground))',
                    fontFamily: "inherit",
                }}
            >
                <span style={{
                    display: "inline-block",
                    fontSize: 12,
                    color: "hsl(var(--muted-foreground))",
                    transition: "transform 0.2s",
                    transform: open ? "rotate(90deg)" : "rotate(0deg)",
                }}>
                    ▶
                </span>
                <h3 style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 700,
                    fontFamily: FONT_DISPLAY,
                    letterSpacing: "-0.01em",
                    color: "hsl(var(--foreground))",
                }}>{title}</h3>
            </button>
            {open && (
                <div style={{ marginTop: 16 }}>
                    {children}
                </div>
            )}
        </div>
    );
}

function StatItem({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) {
    return (
        <div>
            <h3 style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "hsl(var(--muted-foreground))",
                marginTop: 0,
                marginBottom: 6,
                fontWeight: 700,
                fontFamily: FONT_DISPLAY,
            }}>
                {label}
            </h3>
            <p style={{
                fontSize: highlight ? 28 : 18,
                fontWeight: highlight ? 800 : 500,
                fontFamily: highlight ? FONT_DISPLAY : FONT_SANS,
                letterSpacing: highlight ? "-0.01em" : "normal",
                color: highlight ? "hsl(var(--tomato))" : "hsl(var(--foreground))",
                margin: 0,
                wordBreak: "break-word"
            }}>
                {value}
            </p>
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
        padding: 24,
        boxShadow: '0 8px 30px hsl(var(--ink) / 0.06)',
        background: 'hsl(var(--card))',
        color: 'hsl(var(--card-foreground))',
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary" | "accent"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-block",
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
