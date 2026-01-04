// app/dashboard/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Inter, Outfit } from "next/font/google"; // Keep fonts if needed, or use defaults
import { TURTLES, CREWS } from "../../ui/constants";

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
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [myTasks, setMyTasks] = useState<Record<string, { label: string; url?: string }[]>>({});

    // New state for rich crew data
    const [crewOptions, setCrewOptions] = useState<CrewOption[]>(() =>
        (CREWS ?? []).map((c: any) => ({
            id: String(c.id),
            label: String(c.label ?? c.id),
            turtles: [],
        }))
    );

    useEffect(() => {
        async function fetchData() {
            try {
                const res = await fetch(`/api/user-data/${id}`);
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to load dashboard");
                }
                const json = await res.json();
                setData(json);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
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
                }
            } catch (e) {
                console.error("Failed to fetch personalized tasks", e);
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
    const orgs = data["Affiliation"] || data["Orgs"] || "None";
    const skills = data["Specialties"] || data["Skills"] || "None";
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
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 10 }}>
                        <Link href={`/?edit=1&memberId=${idValue}`} style={{
                            ...btn("primary"),
                            fontSize: 14,
                            textDecoration: "none"
                        }}>
                            Edit Profile
                        </Link>
                    </div>


                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                        <StatItem label="Name" value={name} />
                        <StatItem label="City" value={city} />
                        <StatItem label="Status" value={status} />
                        <StatItem label="Orgs" value={orgs} />
                        <StatItem label="Skills" value={skills} />
                        <StatItem label="Discord" value={discord} />
                        <StatItem label="Telegram" value={telegram} />

                        {/* Roles moved here - Images only */}
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
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {turtleList.length > 0 ? (
                                    turtleList.map((tName: string) => {
                                        const tDef = TURTLES.find(t => t.id.toLowerCase() === tName.toLowerCase() || t.label.toLowerCase() === tName.toLowerCase());
                                        if (!tDef) return null; // Skip unknown or text-only if we only want images
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
                        </div>
                    </div>

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
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
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
                                                            {c.callTime ? c.callTime : ""}
                                                            {c.callTime && c.callLength ? " • " : ""}
                                                            {c.callLength ? c.callLength : ""}
                                                        </div>
                                                    )}

                                                    {(() => {
                                                        const personalTasks = myTasks[c?.id || ""] || myTasks[cid] || [];
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

                                                        if (displayTasks.length === 0) return null;

                                                        return (
                                                            <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
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
                                                            </div>
                                                        );
                                                    })()}

                                                    {c?.sheet && (
                                                        <a
                                                            href={c.sheet}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{
                                                                fontSize: 13,
                                                                fontWeight: 650,
                                                                opacity: 0.85,
                                                                textDecoration: "none",
                                                                marginTop: 6,
                                                                display: "inline-block"
                                                            }}
                                                            title={c.sheet}
                                                        >
                                                            Open crew sheet ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}



                    <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.1)", textAlign: "center" }}>
                        <Link href="/" style={btn("secondary")}>
                            Back Home
                        </Link>
                    </div>
                </div>

                {/* Footer info */}
                <div style={{ textAlign: "center", marginTop: 40, opacity: 0.4, fontSize: 13 }}>
                    PizzaDAO
                </div>
            </div>
        </div>
    );
}

function StatItem({ label, value }: { label: string, value: string }) {
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
                fontSize: 18,
                fontWeight: 500,
                color: "#111",
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
