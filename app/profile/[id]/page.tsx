// app/profile/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { TURTLES, CREWS } from "../../ui/constants";
import { NFTCollection } from "../../ui/nft";
import { POAPCollection } from "../../ui/poap";
import { ProfileLinksDisplay } from "../../ui/profile-links";

const inter = Inter({ subsets: ["latin"] });

type CrewOption = {
    id: string;
    label: string;
    turtles?: string[] | string;
    emoji?: string;
    callTime?: string;
    callTimeUrl?: string;
    callLength?: string;
};

function norm(s: unknown) {
    return String(s ?? "").trim().replace(/\s+/g, " ");
}

function splitTurtlesCell(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(norm).filter(Boolean);
    const s = norm(v);
    if (!s) return [];
    return s.split(/[,/|]+/).map((x) => norm(x)).filter(Boolean);
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pfpUrl, setPfpUrl] = useState<string | null>(null);
    const [crewOptions, setCrewOptions] = useState<CrewOption[]>([]);
    const [myTasks, setMyTasks] = useState<Record<string, { label: string; url?: string }[]>>({});
    const [doneCounts, setDoneCounts] = useState<Record<string, number>>({});

    // Fetch public profile data
    useEffect(() => {
        async function fetchProfile() {
            try {
                const res = await fetch(`/api/profile/${id}`);
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to load profile");
                }
                const profileData = await res.json();
                setData(profileData);
            } catch (e: unknown) {
                setError((e as any)?.message);
            } finally {
                setLoading(false);
            }
        }
        fetchProfile();
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

    // Fetch crew mappings for crew info
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/crew-mappings", { cache: "no-store" });
                const data = await res.json();
                if (res.ok && Array.isArray(data?.crews)) {
                    setCrewOptions(data.crews.map((c: any) => ({
                        id: String(c?.id ?? ""),
                        label: norm(c?.label ?? ""),
                        turtles: splitTurtlesCell(c?.turtles),
                        emoji: norm(c?.emoji) || undefined,
                        callTime: norm(c?.callTime) || undefined,
                        callTimeUrl: norm(c?.callTimeUrl) || undefined,
                        callLength: norm(c?.callLength) || undefined,
                    })));
                }
            } catch { }
        })();
    }, []);

    // Fetch member's tasks
    useEffect(() => {
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
    }, [id]);

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
                    <div style={{
                        width: 50,
                        height: 50,
                        border: '4px solid var(--color-spinner-track)',
                        borderTop: '4px solid var(--color-spinner-active)',
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto 20px"
                    }} />
                    <p style={{ fontSize: 18, opacity: 0.8 }}>Loading profile...</p>
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
                background: 'var(--color-page-bg)',
                color: 'var(--color-text)',
                fontFamily: inter.style.fontFamily,
                padding: 20
            }}>
                <div style={card()}>
                    <h1 style={{ fontSize: 24, marginBottom: 16 }}>Profile Not Found</h1>
                    <p style={{ opacity: 0.7, marginBottom: 32 }}>{error || "This member doesn't exist."}</p>
                    <button onClick={() => router.back()} style={btn("primary")}>
                        ← Go Back
                    </button>
                </div>
            </div>
        );
    }

    const name = data["Name"] || data["Mafia Name"] || "Anonymous Pizza Maker";
    const city = data["City"] || "Worldwide";
    const idValue = data["ID"] || data["Crew ID"] || id;
    const crewsStr = data["Crews"] || "None";
    const status = data["Status"] || data["Frequency"] || "";
    const orgs = data["Affiliation"] || data["Orgs"] || "";
    const skills = data["Specialties"] || data["Skills"] || "";

    const rawTurtles = data["Turtles"] || data["Roles"] || [];
    const turtleList = (Array.isArray(rawTurtles) ? rawTurtles : String(rawTurtles).split(",").map(t => t.trim())).filter(Boolean);

    const userCrews = (crewsStr !== "None" ? crewsStr.split(",").map((c: string) => c.trim()).filter(Boolean) : []) as string[];

    const isPizzaMafia = turtleList.some(t => t.toLowerCase().includes("pizza mafia") || t.toLowerCase() === "mafia");
    const memberTitle = isPizzaMafia ? "Pizza Mafia" : "PizzaDAO Member";

    return (
        <div style={{
            minHeight: "100vh",
            background: 'var(--color-page-bg)',
            color: 'var(--color-text)',
            fontFamily: inter.style.fontFamily,
            padding: "40px 20px"
        }}>
            <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
                {/* Back Button */}
                <div>
                    <button
                        onClick={() => router.back()}
                        style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 16,
                            fontWeight: 600,
                            color: 'var(--color-text-secondary)',
                            padding: 0,
                            fontFamily: "inherit"
                        }}
                    >
                        ← Back
                    </button>
                </div>

                {/* Header */}
                <header style={{ textAlign: "center", marginBottom: 20 }}>
                    <h1 style={{
                        marginTop: 0,
                        fontSize: 32,
                        marginBottom: 8,
                        fontWeight: 800
                    }}>
                        {memberTitle}
                    </h1>
                </header>

                {/* Main Card */}
                <div style={card()}>
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
                                    imageRendering: "crisp-edges",
                                    WebkitBackfaceVisibility: "hidden",
                                    transform: "translateZ(0)"
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                }}
                            />
                        </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                        <StatItem label="Name" value={name} />
                        <StatItem label="City" value={city} />
                        <StatItem label="Status" value={status || "—"} />
                        <StatItem label="ID" value={`#${idValue}`} />
                        {orgs && <StatItem label="Orgs" value={orgs} />}
                        {skills && <StatItem label="Skills" value={skills} />}

                        {/* Roles */}
                        <div style={{ gridColumn: "1 / -1" }}>
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
                                            <Link
                                                key={tDef.id}
                                                href={`/turtles/${encodeURIComponent(tDef.id)}`}
                                                title={`View all ${tDef.label} members`}
                                            >
                                                <img
                                                    src={tDef.image}
                                                    alt={tDef.label}
                                                    style={{ width: 40, height: 40, objectFit: "contain" }}
                                                />
                                            </Link>
                                        );
                                    })
                                ) : (
                                    <span style={{ fontSize: 18, fontWeight: 500, opacity: 0.5 }}>None</span>
                                )}
                            </div>

                            {(() => {
                                // Roles to hide from profile display (administrative/verification roles)
                                const hiddenRoles = new Set([
                                    "pockets checked",
                                    "verified",
                                    "server booster",
                                    "nitro booster",
                                    "@everyone",
                                    "everyone",
                                    "member",
                                    "new member",
                                    "pizza noob",
                                ]);
                                const otherRoles = turtleList.filter((tName: string) => {
                                    const nameLower = tName.toLowerCase();
                                    // Exclude core turtle roles
                                    if (TURTLES.find(t => t.id.toLowerCase() === nameLower || t.label.toLowerCase() === nameLower)) {
                                        return false;
                                    }
                                    // Exclude hidden/unimportant roles
                                    if (hiddenRoles.has(nameLower)) {
                                        return false;
                                    }
                                    return true;
                                });
                                if (otherRoles.length === 0) return null;
                                return (
                                    <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
                                        <strong>Other Roles:</strong> {otherRoles.join(", ")}
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Profile Links - read-only display */}
                        <ProfileLinksDisplay memberId={idValue} />

                        {/* POAP Collection - inside profile grid under roles */}
                        <div style={{ gridColumn: "1 / -1" }}>
                            <POAPCollection memberId={idValue} />
                        </div>
                    </div>

                    {/* NFT Collection Section - only shows if wallet exists and has NFTs */}
                    <NFTCollection memberId={idValue} showConnectPrompt={false} />

                    {/* Crews Section */}
                    {userCrews.length > 0 && (
                        <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--color-divider)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>Crews</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                                {userCrews.map((crewName) => {
                                    const c = crewOptions.find(opt =>
                                        opt.label.toLowerCase() === crewName.toLowerCase() ||
                                        opt.id.toLowerCase() === crewName.toLowerCase()
                                    );
                                    const label = c?.label || crewName;
                                    const emoji = c?.emoji || "🍕";
                                    const crewId = (c?.id || crewName).toLowerCase();
                                    const tasks = myTasks[crewId] || [];
                                    const doneCount = doneCounts[crewId] || 0;

                                    return (
                                        <div
                                            key={crewName}
                                            style={{
                                                padding: 12,
                                                borderRadius: 12,
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-surface)',
                                            }}
                                        >
                                            <Link
                                                href={`/crew/${c?.id || crewName.toLowerCase().replace(/\s+/g, "_")}`}
                                                style={{
                                                    fontWeight: 600,
                                                    textDecoration: "none",
                                                    color: "inherit"
                                                }}
                                            >
                                                {emoji} {label}
                                            </Link>

                                            {/* Closed count */}
                                            {doneCount > 0 && (
                                                <div style={{
                                                    marginTop: 8,
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    color: "#10b981"
                                                }}>
                                                    Closed: {doneCount}
                                                </div>
                                            )}

                                            {/* Claimed tasks */}
                                            {tasks.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.5,
                                                        color: "#ff4d4d",
                                                        marginBottom: 4
                                                    }}>
                                                        Claimed Tasks
                                                    </div>
                                                    {tasks.slice(0, 3).map((t, idx) => (
                                                        <div key={idx} style={{
                                                            fontSize: 12,
                                                            display: "flex",
                                                            alignItems: "baseline",
                                                            gap: 4,
                                                            marginTop: 2
                                                        }}>
                                                            <span style={{ color: "#ff4d4d" }}>•</span>
                                                            {t.url ? (
                                                                <a
                                                                    href={t.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
                                                                >
                                                                    {t.label}
                                                                </a>
                                                            ) : (
                                                                <span>{t.label}</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ textAlign: "center", marginTop: 40, opacity: 0.4, fontSize: 13 }}>
                    PizzaDAO
                </div>
            </div>
        </div>
    );
}

function StatItem({ label, value }: { label: string; value: string }) {
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
                color: 'var(--color-text-primary)',
                margin: 0,
                wordBreak: "break-word"
            }}>
                {value}
            </p>
        </div>
    );
}

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
        display: "inline-block",
        padding: "10px 16px",
        borderRadius: 10,
        border: '1px solid var(--color-border-strong)',
        fontWeight: 650,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        fontFamily: "inherit"
    };
    if (kind === "primary") return { ...base, background: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)', borderColor: 'var(--color-btn-primary-border)' };
    return { ...base, background: 'var(--color-surface)', color: 'var(--color-text)' };
}
