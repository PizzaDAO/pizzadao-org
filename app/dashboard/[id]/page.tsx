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

type CrewMappingsResponse = {
    crews: CrewOption[];
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
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [myTasks, setMyTasks] = useState<Record<string, { label: string; url?: string }[]>>({});
    const [doneCounts, setDoneCounts] = useState<Record<string, number>>({});
    const [pfpUrl, setPfpUrl] = useState<string | null>(null);
    const [editingSkills, setEditingSkills] = useState(false);
    const [skillsInput, setSkillsInput] = useState("");
    const [skillsSaving, setSkillsSaving] = useState(false);
    const [editingOrgs, setEditingOrgs] = useState(false);
    const [orgsInput, setOrgsInput] = useState("");
    const [orgsSaving, setOrgsSaving] = useState(false);
    const [pepBalance, setPepBalance] = useState<number | null>(null);
    const [showSendModal, setShowSendModal] = useState(false);

    // New state for rich crew data
    const [crewOptions, setCrewOptions] = useState<CrewOption[]>(() =>
        (CREWS ?? []).map((c: any) => ({
            id: String(c.id),
            label: String(c.label ?? c.id),
            turtles: [],
        }))
    );

    // Verify auth on mount - API handles ownership check
    useEffect(() => {
        async function verifyAuth() {
            try {
                // Fetch user data - API requires auth and verifies ownership
                const dataRes = await fetch(`/api/user-data/${id}`);
                if (!dataRes.ok) {
                    const errData = await dataRes.json();
                    if (dataRes.status === 401) {
                        setAuthError("Please log in to view your dashboard");
                        return;
                    }
                    if (dataRes.status === 403) {
                        setAuthError("You don't have permission to view this dashboard");
                        return;
                    }
                    throw new Error(errData.error || "Failed to load dashboard");
                }
                const userData = await dataRes.json();
                setData(userData);
            } catch (e: unknown) {
                setError((e as any)?.message);
            } finally {
                setLoading(false);
            }
        }
        verifyAuth();
    }, [id]);

    // Fetch profile picture
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/pfp/${id}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.url) setPfpUrl(json.url);
                }
            } catch (e) {
            }
        })();
    }, [id]);

    // Fetch crew mappings to get tasks, call times etc.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/crew-mappings", { cache: "no-store" });
                const data = (await res.json()) as CrewMappingsResponse | any;
                if (!res.ok) throw new Error(data?.error || "Failed to load crews");

                const crews: CrewOption[] = Array.isArray(data?.crews) ? data.crews : [];
                const cleaned = crews
                    .map((c) => ({
                        ...c,
                        id: String((c as any)?.id ?? ""),
                        label: norm((c as any)?.label ?? ""),
                        turtles: splitTurtlesCell((c as any)?.turtles),
                        emoji: norm((c as any)?.emoji) || undefined,
                        role: norm((c as any)?.role) || undefined,
                        channel: norm((c as any)?.channel) || undefined,
                        event: norm((c as any)?.event) || undefined,
                        sheet: norm((c as any)?.sheet) || undefined,
                        callTime: norm((c as any)?.callTime) || undefined,
                        callTimeUrl: norm((c as any)?.callTimeUrl) || undefined,
                        callLength: norm((c as any)?.callLength) || undefined,
                        tasks: Array.isArray((c as any)?.tasks) ? (c as any).tasks : [],
                    }))
                    .filter((c) => c.id && c.label);

                if (!alive) return;
                if (cleaned.length) setCrewOptions(cleaned);
            } catch {
                // keep fallback crews
            }
        })();

        // Fetch personalized tasks
        (async () => {
            try {
                const res = await fetch(`/api/my-tasks/${id}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.tasksByCrew) setMyTasks(json.tasksByCrew);
                    if (json.doneCountsByCrew) setDoneCounts(json.doneCountsByCrew);
                }
            } catch (e) {
            }
        })();

        // Fetch $PEP balance
        (async () => {
            try {
                const res = await fetch("/api/economy/balance");
                if (res.ok) {
                    const json = await res.json();
                    setPepBalance(json.balance);
                }
            } catch (e) {
            }
        })();

        return () => {
            alive = false;
        };
    }, [id]);

    if (loading) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fafafa",
                color: "#000",
                fontFamily: inter.style.fontFamily
            }}>
                <div style={{ textAlign: "center" }}>
                    <div className="spinner" style={{
                        width: 50,
                        height: 50,
                        border: "4px solid rgba(0,0,0,0.1)",
                        borderTop: "4px solid #ff4d4d",
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
                background: "#fafafa",
                color: "#000",
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
                background: "#fafafa",
                color: "#000",
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
            background: "#fafafa",
            color: "#000",
            fontFamily: inter.style.fontFamily,
            padding: "40px 20px"
        }}>
            <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
                {/* Header */}
                <header style={{ textAlign: "center", marginBottom: 20 }}>
                    <h1 style={{
                        marginTop: 0,
                        fontSize: 32,
                        marginBottom: 8,
                        fontWeight: 800
                    }}>
                        PizzaDAO Dashboard
                    </h1>
                    <p style={{ fontSize: 18, opacity: 0.6 }}>Welcome to the Family, Member #{idValue}</p>
                </header>

                {/* Main Card */}
                <div style={card()}>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                        <NotificationBell />
                        <Link href="/crews" style={{
                            ...btn("secondary"),
                            fontSize: 14,
                            textDecoration: "none"
                        }}>
                            All Crews
                        </Link>
                        <Link href="/tech/projects" style={{
                            ...btn("secondary"),
                            fontSize: 14,
                            textDecoration: "none"
                        }}>
                            Projects
                        </Link>
                        <Link href="/pep" style={{
                            ...btn("secondary"),
                            fontSize: 14,
                            textDecoration: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            <PepIcon size={16} /> Economy
                        </Link>
                        <Link href={`/?edit=1&memberId=${idValue}`} style={{
                            ...btn("primary"),
                            fontSize: 14,
                            textDecoration: "none"
                        }}>
                            Edit Profile
                        </Link>
                    </div>

                    {/* Profile Picture */}
                    {pfpUrl && (
                        <div style={{ textAlign: "center", marginBottom: 16 }}>
                            <img
                                src={pfpUrl}
                                alt={`${name}'s profile`}
                                style={{
                                    width: 150,
                                    height: 150,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                    objectPosition: "top",
                                    border: "4px solid #fafafa",
                                    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                                    imageRendering: "crisp-edges"
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                }}
                            />
                        </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
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
                                Name
                            </h3>
                            <Link
                                href={`/profile/${idValue}`}
                                style={{
                                    fontSize: 18,
                                    fontWeight: 500,
                                    color: "#111",
                                    textDecoration: "none"
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                                onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                            >
                                {name}
                            </Link>
                        </div>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {/* Wallet Icon */}
                                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                                </svg>
                                <span style={{
                                    fontSize: 24,
                                    fontWeight: 700,
                                    color: "#16a34a"
                                }}>
                                    {pepBalance !== null ? <PepAmount amount={pepBalance} size={20} /> : "—"}
                                </span>
                                {/* Send Button */}
                                <button
                                    onClick={() => setShowSendModal(true)}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 4,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        opacity: 0.6,
                                    }}
                                    title="Send PEP"
                                >
                                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 2L11 13" />
                                        <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <StatItem label="City" value={city} />
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
                                            border: "1px solid rgba(0,0,0,0.2)",
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
                                    color: "#111",
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
                                            border: "1px solid rgba(0,0,0,0.2)",
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
                                    color: "#111",
                                    margin: 0,
                                    wordBreak: "break-word"
                                }}>
                                    {skills}
                                </p>
                            )}
                        </div>
                        <StatItem label="Discord" value={discord} />
                        <StatItem label="Telegram" value={telegram} />

                        {/* Roles moved here - Images + Sync Button */}
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

                                {/* Sync Button - hidden: roles now auto-sync on login.
                                   Keeping the SyncRolesButton component and API route
                                   intact for potential manual use later. */}
                            </div>
                        </div>

                        {/* POAP Collection - inside profile grid under roles */}
                        <div style={{ gridColumn: "1 / -1" }}>
                            <POAPCollection memberId={idValue} />
                        </div>

                        {/* Profile Links - editable */}
                        <ProfileLinksEditor memberId={idValue} />
                    </div>

                    {/* NFT Collection Section - shows connect prompt if no wallet */}
                    <NFTCollection memberId={idValue} showConnectPrompt={true} />

                    {/* Crews Section - MATCHING STEP 5 UI */}
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
                            <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.1)" }}>
                                <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>Your Crews</h3>
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
                                                                            const isPersonal = personalTasks?.some(pt => pt.label === t.label);
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

                    <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.1)", textAlign: "center" }}>
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
                        // Refresh balance
                        fetch("/api/economy/balance")
                            .then(res => res.json())
                            .then(json => setPepBalance(json.balance))
                            .catch(() => {});
                    }}
                />
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
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 14,
        padding: 24,
        boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
        background: "white",
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-block", // ensure links behave like buttons
        padding: "10px 16px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.18)",
        fontWeight: 650,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center"
    };
    if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
    return { ...base, background: "white", color: "black" };
}

function tile(): React.CSSProperties {
    return {
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)", // slightly lighter border for display only
        background: "white",
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
        border: "1px solid rgba(0,0,0,0.12)",
        background: "white",
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
        border: "1px solid rgba(0,0,0,0.18)",
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
            background: "rgba(0,0,0,0.5)",
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
