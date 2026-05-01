// app/dashboard/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter, Outfit } from "next/font/google"; // Keep fonts if needed, or use defaults
import { Pencil } from "lucide-react";
import { TURTLES, CREWS } from "../../ui/constants";
import { PepIcon, PepAmount } from "../../ui/economy";
import { NFTCollection } from "../../ui/nft";
import { POAPCollection } from "../../ui/poap";
import { NotificationBell } from "../../ui/notifications";
import { ProfileLinksEditor } from "../../ui/profile-links";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { MissionsProgress } from "../../ui/missions";
import { UnlockTicketCard } from "../../ui/unlock-ticket-card";
import { WalletManager } from "../../ui/wallet-manager/WalletManager";
import { VouchesWidget } from "../../ui/vouches/VouchesWidget";
import { SocialAccountLinker } from "../../ui/vouches/SocialAccountLinker";
import { useQueryClient } from "@tanstack/react-query";
import { useUserData, usePfp, useXAccount, useCrewMappings, useMyTasks, useMyBalance } from "../../lib/hooks/use-api";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"] });

// Types copied from OnboardingWizard to ensure compatibility
type CrewOption = {
    id: string;
    label: string;
    turtles?: string[] | string;
    role?: string;
    channel?: string;
    event?: string;
    emoji?: string;
    sheet?: string;
    callTime?: string;
    callTimeUrl?: string;
    callLength?: string;
    tasks?: { label: string; url?: string }[];
};

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
    const queryClient = useQueryClient();

    // --- React Query hooks for data fetching ---
    const { data: userData, isLoading: userDataLoading, error: userDataError } = useUserData(id);
    const { data: pfpData } = usePfp(id);
    const { data: xAccountData } = useXAccount(id);
    const { data: crewMappingsData } = useCrewMappings();
    const { data: tasksData } = useMyTasks(id);
    const { data: balanceData } = useMyBalance();

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

    // Derived data from hooks
    const pfpUrl = pfpData?.url ?? null;
    const pepBalance = balanceData?.balance ?? null;
    const myTasks = tasksData?.tasksByCrew ?? {};
    const doneCounts = tasksData?.doneCountsByCrew ?? {};

    // X account: local state because disconnect handler mutates it
    const [xAccount, setXAccount] = useState<{ connected: boolean; username?: string; displayName?: string } | null>(null);
    useEffect(() => {
        if (xAccountData) setXAccount(xAccountData);
    }, [xAccountData]);

    // Mission level for hero header
    const [missionLevel, setMissionLevel] = useState<{ level: number; title: string } | null>(null);
    useEffect(() => {
        fetch("/api/missions").then(r => r.ok ? r.json() : null).then(d => {
            if (d?.currentLevel != null) {
                setMissionLevel({ level: d.currentLevel, title: d.levelTitle || "" });
            }
        }).catch(() => {});
    }, []);

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
                background: 'var(--color-page-bg)',
                color: 'var(--color-text)',
                fontFamily: inter.style.fontFamily
            }}>
                <div style={{ textAlign: "center" }}>
                    <div className="spinner" style={{
                        width: 50,
                        height: 50,
                        border: '4px solid var(--color-spinner-track)',
                        borderTop: '4px solid var(--color-spinner-active)',
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto 20px"
                    }} />
                    <p style={{ fontSize: 18, opacity: 0.8 }}>Loading your Mafia stats...</p>
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
                background: 'var(--color-page-bg)',
                color: 'var(--color-text)',
                fontFamily: inter.style.fontFamily,
                padding: 20
            }}>
                <div style={card()}>
                    <h1 style={{ fontSize: 24, marginBottom: 16 }}>Access Denied</h1>
                    <p style={{ opacity: 0.7, marginBottom: 32 }}>{authError}</p>
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
                background: 'var(--color-page-bg)',
                color: 'var(--color-text)',
                fontFamily: inter.style.fontFamily,
                padding: 20
            }}>
                <div style={card()}>
                    <h1 style={{ fontSize: 24, marginBottom: 16 }}>Oops!</h1>
                    <p style={{ opacity: 0.7, marginBottom: 32 }}>{error || "We couldn't find your data. Are you sure you're in the Crew yet?"}</p>
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
            background: 'var(--color-page-bg)',
            color: 'var(--color-text)',
            fontFamily: inter.style.fontFamily,
            padding: "40px 20px"
        }}>
            <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
                {/* Main Card */}
                <div style={card()}>

                    {/* ── 1. Compact Hero Header ── */}
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        {pfpUrl && (
                            <img
                                src={pfpUrl}
                                alt={`${name}'s profile`}
                                style={{
                                    width: 80,
                                    height: 80,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                    objectPosition: "top",
                                    border: "3px solid #fafafa",
                                    boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
                                    imageRendering: "crisp-edges",
                                    flexShrink: 0,
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                }}
                            />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                                <Link
                                    href={`/profile/${idValue}`}
                                    style={{
                                        fontSize: 24,
                                        fontWeight: 800,
                                        color: 'var(--color-text-primary)',
                                        textDecoration: "none",
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                                >
                                    {name}
                                </Link>
                                {missionLevel && (
                                    <span style={{ fontSize: 13, opacity: 0.55, whiteSpace: "nowrap" }}>
                                        Lv.{missionLevel.level} {missionLevel.title}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 14, opacity: 0.6 }}>{city}</span>
                                <span style={{ opacity: 0.3 }}>·</span>
                                <span style={{ fontSize: 14, fontWeight: 600, color: "#16a34a", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    {pepBalance !== null ? <PepAmount amount={pepBalance} size={14} /> : "—"}
                                </span>
                                <button
                                    onClick={() => setShowSendModal(true)}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 2,
                                        display: "flex",
                                        alignItems: "center",
                                        opacity: 0.5,
                                    }}
                                    title="Send PEP"
                                >
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 2L11 13" />
                                        <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <Link href={`/?edit=1&memberId=${idValue}`} style={{
                                ...btn("primary"),
                                fontSize: 13,
                                padding: "6px 12px",
                                textDecoration: "none",
                            }}>
                                Edit Profile
                            </Link>
                            <ThemeToggle />
                            <NotificationBell />
                        </div>
                    </div>

                    {/* ── 2. Slim Nav (5 links) ── */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                        <Link href="/tech/projects" style={{ ...btn("secondary"), fontSize: 13, textDecoration: "none" }}>
                            Projects
                        </Link>
                        <Link href="/articles" style={{ ...btn("secondary"), fontSize: 13, textDecoration: "none" }}>
                            Articles
                        </Link>
                        <Link href="/crew" style={{ ...btn("secondary"), fontSize: 13, textDecoration: "none" }}>
                            All Members
                        </Link>
                        <Link href="/calls" style={{ ...btn("secondary"), fontSize: 13, textDecoration: "none" }}>
                            Calls
                        </Link>
                        <Link href="/pep" style={{
                            ...btn("secondary"),
                            fontSize: 13,
                            textDecoration: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}>
                            <PepIcon size={14} /> Economy
                        </Link>
                    </div>

                    {/* ── 3. Missions Progress ── */}
                    <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                        <MissionsProgress />
                    </div>

                    {/* ── 4. Your Crews ── */}
                    {(() => {
                        // Normalize userCrews to IDs where possible
                        const userCrewIds = userCrews.map(name => {
                            const found = crewOptions.find(opt => opt.label.toLowerCase() === name.toLowerCase() || opt.id.toLowerCase() === name.toLowerCase());
                            return found ? found.id : name;
                        });

                        // Combine with IDs from myTasks
                        const taskCrewIds = Object.keys(myTasks);
                        const allDisplayIds = Array.from(new Set([...userCrewIds, ...taskCrewIds]));

                        if (allDisplayIds.length === 0) return null;

                        return (
                            <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                                    <h3 style={{ margin: 0, fontSize: 18 }}>Your Crews</h3>
                                    <Link href="/crew" style={{ fontSize: 13, fontWeight: 650, color: "#ff4d4d", textDecoration: "none" }}>
                                        View all crews →
                                    </Link>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                                    {allDisplayIds.map((cid) => {
                                        // Find rich crew definition
                                        const c = crewOptions.find(opt => opt.id.toLowerCase() === cid.toLowerCase() || opt.label.toLowerCase() === cid.toLowerCase());

                                        // If not found, use a basic fallback
                                        const label = c?.label || cid;
                                        const emoji = c?.emoji || "🍕";

                                        return (
                                            <div key={cid} style={crewCard()}>
                                                <div style={{ display: "grid", gap: 4 }}>
                                                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                                        <span style={{ fontWeight: 700 }}>
                                                            {emoji ? `${emoji} ` : ""}
                                                            {label}
                                                        </span>
                                                    </div>

                                                    {(c?.callTime || c?.callLength) && (
                                                        <div style={{ opacity: 0.7, fontSize: 13 }}>
                                                            {c.callTime ? (
                                                                c.callTimeUrl ? (
                                                                    <a href={c.callTimeUrl} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                                                                        {c.callTime}
                                                                    </a>
                                                                ) : c.callTime
                                                            ) : ""}
                                                            {c.callTime && c.callLength ? " • " : ""}
                                                            {c.callLength ? c.callLength : ""}
                                                        </div>
                                                    )}

                                                    {(() => {
                                                        const currentCid = String(c?.id || cid).toLowerCase();
                                                        const doneCount = doneCounts[currentCid] || 0;
                                                        const personalTasks = myTasks[currentCid] || [];
                                                        const topTasks = c?.tasks || [];
                                                        const hasPersonal = personalTasks && personalTasks.length > 0;

                                                        // Merge: Personal first, then Top Tasks to fill up to 3
                                                        let displayTasks = [...personalTasks];
                                                        if (displayTasks.length < 3) {
                                                            const remaining = 3 - displayTasks.length;
                                                            // Filter out top tasks that are already in personal tasks (by label)
                                                            const personalLabels = new Set(displayTasks.map(t => t.label.toLowerCase()));
                                                            const additional = topTasks
                                                                .filter(t => !personalLabels.has(t.label.toLowerCase()))
                                                                .slice(0, remaining);
                                                            displayTasks = [...displayTasks, ...additional];
                                                        }
                                                        if (displayTasks.length === 0 && doneCount === 0) return null;

                                                        return (
                                                            <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                                                                {doneCount > 0 && (
                                                                    <div style={{
                                                                        fontSize: 11,
                                                                        fontWeight: 700,
                                                                        opacity: 0.8,
                                                                        textTransform: "uppercase",
                                                                        letterSpacing: 0.5,
                                                                        color: "#10b981",
                                                                        marginBottom: 2
                                                                    }}>
                                                                        Closed: {doneCount}
                                                                    </div>
                                                                )}
                                                                {displayTasks.length > 0 && (
                                                                    <>
                                                                        <div style={{
                                                                            fontSize: 11,
                                                                            fontWeight: 700,
                                                                            opacity: 0.8,
                                                                            textTransform: "uppercase",
                                                                            letterSpacing: 0.5,
                                                                            color: hasPersonal ? "#ff4d4d" : "rgba(0,0,0,0.6)"
                                                                        }}>
                                                                            {hasPersonal ? "Your Tasks" : "Top Tasks"}
                                                                        </div>
                                                                        {displayTasks.map((t, idx) => {
                                                                            const isPersonal = personalTasks?.some((pt: { label: string }) => pt.label === t.label);
                                                                            return (
                                                                                <div key={idx} style={{
                                                                                    fontSize: 12,
                                                                                    opacity: isPersonal ? 1 : 0.7,
                                                                                    fontWeight: isPersonal ? 600 : 400,
                                                                                    display: "flex",
                                                                                    alignItems: "baseline",
                                                                                    gap: 4,
                                                                                    minWidth: 0
                                                                                }}>
                                                                                    <span style={{ flexShrink: 0, color: isPersonal ? "#ff4d4d" : "inherit" }}>•</span>
                                                                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                                        {t.url ? (
                                                                                            <a
                                                                                                href={t.url}
                                                                                                target="_blank"
                                                                                                rel="noreferrer"
                                                                                                onClick={(e) => e.stopPropagation()}
                                                                                                style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
                                                                                            >
                                                                                                {t.label}
                                                                                            </a>
                                                                                        ) : (
                                                                                            <span>{t.label}</span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                                                        <Link
                                                            href={`/crew/${c?.id || cid}`}
                                                            style={{
                                                                fontSize: 13,
                                                                fontWeight: 650,
                                                                color: "#ff4d4d",
                                                                textDecoration: "none",
                                                            }}
                                                        >
                                                            View crew page →
                                                        </Link>
                                                        {c?.sheet && (
                                                            <a
                                                                href={c.sheet}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                onClick={(e) => e.stopPropagation()}
                                                                style={{
                                                                    fontSize: 13,
                                                                    fontWeight: 650,
                                                                    opacity: 0.7,
                                                                    textDecoration: "none",
                                                                }}
                                                                title={c.sheet}
                                                            >
                                                                Open sheet ↗
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── 5. Vouches Widget ── */}
                    <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
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
                                        fontSize: 12,
                                        textTransform: "uppercase",
                                        letterSpacing: "1px",
                                        opacity: 0.5,
                                        margin: 0,
                                        fontWeight: 700
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
                                                border: '1px solid var(--color-border-strong)',
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
                                        color: 'var(--color-text-primary)',
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
                                        fontSize: 12,
                                        textTransform: "uppercase",
                                        letterSpacing: "1px",
                                        opacity: 0.5,
                                        margin: 0,
                                        fontWeight: 700
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
                                                border: '1px solid var(--color-border-strong)',
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
                                        color: 'var(--color-text-primary)',
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
                                            fontSize: 12,
                                            textTransform: "uppercase",
                                            letterSpacing: "1px",
                                            opacity: 0.5,
                                            marginTop: 0,
                                            marginBottom: 6,
                                            fontWeight: 700
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
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-surface)',
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
                                                    color: 'var(--color-text-primary)',
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
                                                border: '1px solid var(--color-border-strong)',
                                                borderRadius: 8,
                                                padding: "6px 12px",
                                                fontSize: 12,
                                                cursor: "pointer",
                                                opacity: xDisconnecting ? 0.5 : 0.7,
                                                fontFamily: "inherit",
                                                color: 'var(--color-text)',
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
                    <div style={{ paddingTop: 16, borderTop: '1px solid var(--color-divider)', textAlign: "center" }}>
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
                <div style={{ textAlign: "center", marginTop: 40, opacity: 0.4, fontSize: 13 }}>
                    PizzaDAO
                </div>
            </div>

            {/* Send Modal */}
            {showSendModal && (
                <SendPepModal
                    onClose={() => setShowSendModal(false)}
                    onSuccess={() => {
                        setShowSendModal(false);
                        // Refresh balance via React Query
                        queryClient.invalidateQueries({ queryKey: ['my-balance'] });
                    }}
                />
            )}
        </div>
    );
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
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
                    color: 'var(--color-text)',
                    fontFamily: "inherit",
                }}
            >
                <span style={{
                    display: "inline-block",
                    fontSize: 12,
                    transition: "transform 0.2s",
                    transform: open ? "rotate(90deg)" : "rotate(0deg)",
                }}>
                    ▶
                </span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h3>
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
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "1px",
                opacity: 0.5,
                marginTop: 0,
                marginBottom: 6,
                fontWeight: 700
            }}>
                {label}
            </h3>
            <p style={{
                fontSize: highlight ? 24 : 18,
                fontWeight: highlight ? 700 : 500,
                color: highlight ? "#16a34a" : "#111",
                margin: 0,
                wordBreak: "break-word"
            }}>
                {value}
            </p>
        </div>
    );
}

// --- Styles copied/adapted from OnboardingWizard ---

function card(): React.CSSProperties {
    return {
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        padding: 24,
        boxShadow: 'var(--shadow-card)',
        background: 'var(--color-surface)',
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-block", // ensure links behave like buttons
        padding: "10px 16px",
        borderRadius: 10,
        border: '1px solid var(--color-border-strong)',
        fontWeight: 650,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center"
    };
    if (kind === "primary") return { ...base, background: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)', borderColor: 'var(--color-btn-primary-border)' };
    return { ...base, background: 'var(--color-surface)', color: 'var(--color-text)' };
}

function tile(): React.CSSProperties {
    return {
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--color-border)', // slightly lighter border for display only
        background: 'var(--color-surface)',
        textAlign: "left",
    };
}

// Adapted from crewRow in OnboardingWizard but without the checkbox styling logic
function crewCard(): React.CSSProperties {
    return {
        display: "flex",
        gap: 10,
        alignItems: "flex-start", // changed to flex-start for multiline
        padding: 10,
        borderRadius: 12,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
    };
}

function SendPepModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [memberId, setMemberId] = useState("");
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!memberId || !amount) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/economy/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toUserId: memberId, amount: Number(amount) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to send");
        } finally {
            setLoading(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: '1px solid var(--color-border-strong)',
        fontSize: 14,
        outline: "none",
        boxSizing: "border-box" as const,
    };

    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--color-overlay)',
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
        }} onClick={onClose}>
            <div style={{ ...card(), maxWidth: 400, width: "90%" }} onClick={e => e.stopPropagation()}>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                    Send <PepIcon size={18} />
                </h2>

                {error && (
                    <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "#c00", fontSize: 14 }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSend} style={{ display: "grid", gap: 16 }}>
                    <div>
                        <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
                            Recipient Member ID
                        </label>
                        <input
                            type="text"
                            placeholder="Enter member ID"
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            style={inputStyle}
                            disabled={loading}
                        />
                    </div>

                    <div>
                        <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
                            Amount
                        </label>
                        <input
                            type="number"
                            placeholder="Amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            style={inputStyle}
                            disabled={loading}
                            min="1"
                        />
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button type="button" onClick={onClose} style={{ ...btn("secondary"), flex: 1, fontFamily: "inherit" }}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !memberId || !amount}
                            style={{ ...btn("primary"), flex: 1, fontFamily: "inherit", opacity: loading || !memberId || !amount ? 0.5 : 1 }}
                        >
                            {loading ? "Sending..." : "Send"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const SyncRolesButton = ({ memberId, discordId, name, onSync }: { memberId: string, discordId: string, name: string, onSync: (turtles: string[], others: string[]) => void }) => {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    const handleSync = async () => {
        setLoading(true);
        setMsg("Syncing...");
        try {
            const res = await fetch("/api/discord/sync-to-sheet", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId, discordId, mafiaName: name })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Sync failed");

            setMsg("Done!");
            setTimeout(() => setMsg(""), 2000);
            onSync(data.turtles, data.otherRoles);
        } catch (e: unknown) {
            setMsg("Error!");
            setTimeout(() => setMsg(""), 2000);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleSync}
            disabled={loading}
            style={{
                background: "transparent",
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 12,
                cursor: loading ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4
            }}
        >
            {loading ? "🔄" : "🔁"} {msg || "Sync Roles"}
        </button>
    );
};
