// app/dashboard/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Inter, Outfit } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"] });

export default function Dashboard({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    if (loading) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
                color: "#fff",
                fontFamily: inter.style.fontFamily
            }}>
                <div style={{ textAlign: "center" }}>
                    <div className="spinner" style={{
                        width: 50,
                        height: 50,
                        border: "4px solid rgba(255,255,255,0.1)",
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
                background: "#0f0c29",
                color: "#fff",
                fontFamily: inter.style.fontFamily,
                padding: 20
            }}>
                <div style={{
                    maxWidth: 400,
                    textAlign: "center",
                    background: "rgba(255, 255, 255, 0.05)",
                    padding: 40,
                    borderRadius: 24,
                    backdropFilter: "blur(10px)",
                    border: "1px solid rgba(255, 255, 255, 0.1)"
                }}>
                    <h1 style={{ fontSize: 32, marginBottom: 16 }}>Oops!</h1>
                    <p style={{ opacity: 0.7, marginBottom: 32 }}>{error || "We couldn't find your data. Are you sure you're in the Crew yet?"}</p>
                    <Link href="/" style={{
                        display: "inline-block",
                        padding: "12px 24px",
                        background: "#ff4d4d",
                        color: "#fff",
                        textDecoration: "none",
                        borderRadius: 12,
                        fontWeight: 600
                    }}>
                        Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    const name = data["Name"] || data["Mafia Name"] || "Anonymous Pizza Maker";
    const city = data["City"] || "Worldwide";
    const idValue = data["ID"] || data["Crew ID"] || id;
    const crews = data["Crews"] || "None";
    const discord = data["DiscordID"] || data["Discord"] || "Not linked";
    const status = data["Frequency"] || data["Status"] || "No status";
    const orgs = data["Affiliation"] || data["Orgs"] || "None";
    const skills = data["Specialties"] || data["Skills"] || "None";
    const telegram = data["Telegram"] || "Not linked";

    return (
        <div style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
            color: "#fff",
            fontFamily: inter.style.fontFamily,
            padding: "40px 20px"
        }}>
            <div style={{ maxWidth: 800, margin: "0 auto" }}>
                {/* Header */}
                <header style={{ textAlign: "center", marginBottom: 60 }}>
                    <h1 style={{
                        fontFamily: outfit.style.fontFamily,
                        fontSize: 48,
                        marginBottom: 8,
                        background: "linear-gradient(to right, #ff4d4d, #f9cb28)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        fontWeight: 800
                    }}>
                        PizzaDAO Dashboard
                    </h1>
                    <p style={{ fontSize: 20, opacity: 0.6 }}>Welcome to the Family, Member #{idValue}</p>
                </header>

                {/* Main Card */}
                <div style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    borderRadius: 32,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    backdropFilter: "blur(20px)",
                    padding: 40,
                    boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
                    position: "relative",
                    overflow: "hidden"
                }}>
                    {/* Decorative element */}
                    <div style={{
                        position: "absolute",
                        top: -50,
                        right: -50,
                        width: 150,
                        height: 150,
                        background: "radial-gradient(circle, #ff4d4d 0%, transparent 70%)",
                        opacity: 0.2,
                        zIndex: 0
                    }} />

                    <div style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                            <StatItem label="Name" value={name} />
                            <StatItem label="City" value={city} />
                            <StatItem label="Status" value={status} />
                            <StatItem label="Orgs" value={orgs} />
                            <StatItem label="Crews" value={crews} />
                            <StatItem label="Skills" value={skills} />
                            <StatItem label="Discord" value={discord} />
                            <StatItem label="Telegram" value={telegram} />
                        </div>

                        <div style={{ marginTop: 48, paddingTop: 32, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                                <Link href="/" style={{
                                    padding: "10px 20px",
                                    background: "rgba(255,255,255,0.05)",
                                    borderRadius: 12,
                                    textDecoration: "none",
                                    color: "#fff",
                                    fontSize: 14,
                                    fontWeight: 500,
                                    transition: "background 0.2s"
                                }}>
                                    Back Home
                                </Link>
                                <button
                                    onClick={() => alert("Profile settings coming soon!")}
                                    style={{
                                        padding: "10px 20px",
                                        background: "#ff4d4d",
                                        borderRadius: 12,
                                        border: "none",
                                        color: "#fff",
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        boxShadow: "0 4px 12px rgba(255, 77, 77, 0.3)"
                                    }}>
                                    Edit Profile
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer info */}
                <div style={{ textAlign: "center", marginTop: 40, opacity: 0.4, fontSize: 13 }}>
                    PizzaDAO • {new Date().getFullYear()} • Making Pizza Free Since 2021
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
                letterSpacing: "1.5px",
                opacity: 0.5,
                marginBottom: 8,
                fontWeight: 600
            }}>
                {label}
            </h3>
            <p style={{
                fontSize: 22,
                fontWeight: 500,
                color: "#fff",
                lineHeight: 1.2
            }}>
                {value}
            </p>
        </div>
    );
}
