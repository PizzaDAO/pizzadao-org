// app/profile/[id]/ProfileClient.tsx
//
// Client child for /profile/[id]. The outer page.tsx is now a server
// component that exports generateMetadata so the route can render rich
// OpenGraph / Twitter previews when a profile URL is shared. All of the
// interactivity (React Query hook, owner-banner state, kebab menu) stays
// here.
//
// onion-47612: editorial restyle. The page chrome now mirrors the
// vocabulary established by PRs #93/#94 — paper-soft cards, "§ NN ·"
// overline section labels, handwritten margin annotations, btn-pill
// CTAs, fade-up reveal, and a sticky bottom dock for the owner-only
// "Edit on dashboard" affordance. Underlying hooks, props, and routing
// behaviour are unchanged.
//
// Plan: plans/truffle-91035-profile-redesign.md §6.3 — PR3 (capricciosa-16483).
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { ProfileHero } from "../../ui/profile/ProfileHero";
import { AboutChips } from "../../ui/profile/AboutChips";
import { CrewChipRow, type CrewOption } from "../../ui/profile/CrewChipRow";
import { ContributionsBlock } from "../../ui/profile/ContributionsBlock";
import { CollectionsLazy } from "../../ui/profile/CollectionsLazy";
import { AttendanceCard } from "../../ui/attendance-card";
import { useProfileSummary } from "../../lib/hooks/use-api";

function norm(s: unknown) {
    return String(s ?? "").trim().replace(/\s+/g, " ");
}

interface ProfileClientProps {
    id: string;
}

export function ProfileClient({ id }: ProfileClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const asVisitor = searchParams?.get("as") === "visitor";

    const { data, isLoading, error } = useProfileSummary(id);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <div className="text-center">
                    <div
                        className="mx-auto mb-5 h-12 w-12 rounded-full"
                        style={{
                            border: "4px solid hsl(var(--ink) / 0.10)",
                            borderTopColor: "hsl(var(--tomato))",
                            animation: "spin 1s linear infinite",
                        }}
                    />
                    <p className="overline text-foreground/55">§ Loading the dossier</p>
                    <style jsx>{`
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `}</style>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="paper-soft halftone-soft grid gap-3 rounded-[28px] border p-7 max-w-md w-full"
                    style={{
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                        borderColor: "hsl(var(--rule-warm) / 0.55)",
                        boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
                    }}
                >
                    <p className="overline text-tomato">§ 404 · Missing</p>
                    <h1
                        className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground m-0"
                        style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", lineHeight: 1.0 }}
                    >
                        Profile not found
                    </h1>
                    <p className="text-foreground/70 m-0">
                        {(error as Error | undefined)?.message || "This member doesn't exist."}
                    </p>
                    <button
                        onClick={() => router.back()}
                        className="btn-pill self-start"
                        style={{
                            background: "hsl(var(--ink))",
                            color: "hsl(var(--cream))",
                        }}
                    >
                        ← Go back
                    </button>
                </div>
            </div>
        );
    }

    const mode = data.isOwner && !asVisitor ? "owner-readonly" : "public";
    const isOwner = mode === "owner-readonly";

    const crewOptions: CrewOption[] = (data.crewOptions as unknown[]).map((c) => {
        const r = c as Record<string, unknown>;
        return {
            id: String(r["id"] ?? ""),
            label: norm(r["label"] ?? ""),
            emoji: norm(r["emoji"]) || undefined,
        };
    });

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* sticky owner dock adds bottom padding so the last card isn't covered */}
            <div className={`mx-auto max-w-3xl px-5 py-6 grid gap-6 fade-up ${isOwner ? "pb-28" : ""}`}>
                {/* Back */}
                <div>
                    <button
                        onClick={() => router.back()}
                        className="overline bg-transparent border-0 p-0 text-foreground/55 hover:text-tomato cursor-pointer transition-colors"
                    >
                        ← Back
                    </button>
                </div>

                <ProfileHero
                    memberId={id}
                    name={data.hero.name}
                    pfpUrl={data.hero.pfpUrl}
                    tagline={data.hero.tagline}
                    city={data.hero.city}
                    level={data.hero.level}
                    levelTitle={data.hero.levelTitle}
                    mafiaRank={data.hero.mafiaRank?.tier ?? null}
                    mode={mode}
                    viewerId={data.viewerId}
                    suppressOwnerBanner={asVisitor}
                />

                <AboutChips
                    memberId={id}
                    skills={data.about.skills}
                    orgs={data.about.orgs}
                    turtles={data.about.turtles}
                    xAccount={data.about.xAccount}
                />

                <CrewChipRow crewIds={data.crewIds} crewOptions={crewOptions} />

                <ContributionsBlock memberId={id} />

                {/* Attendance — uses inline variant so this page owns the wrapper */}
                <section
                    className="paper-soft halftone-soft rounded-[24px] border p-5 sm:p-6"
                    style={{
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                        borderColor: "hsl(var(--rule-warm) / 0.55)",
                        boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
                    }}
                >
                    <p className="overline text-tomato mb-3">§ 05 · Showing up</p>
                    <AttendanceCard memberId={id} variant="inline" />
                </section>

                <CollectionsLazy memberId={id} />

                <div className="mt-6 text-center">
                    <p className="overline text-foreground/35">§ End of the dossier</p>
                    <p
                        aria-hidden
                        className="handwritten text-foreground/45 mt-2 inline-block"
                        style={{ transform: "rotate(-2deg)", fontSize: 16 }}
                    >
                        — fin —
                    </p>
                </div>
            </div>

            {/* Editorial sticky bottom dock — owner-only "Edit on dashboard" CTA. */}
            {isOwner && (
                <div
                    className="fixed inset-x-0 bottom-0 z-30 pointer-events-none"
                    aria-hidden={false}
                >
                    <div
                        className="pointer-events-auto mx-auto max-w-3xl px-5 pb-4"
                        style={{
                            background:
                                "linear-gradient(to top, hsl(var(--cream)) 35%, hsl(var(--cream) / 0) 100%)",
                            paddingTop: 32,
                        }}
                    >
                        <div
                            className="paper-soft-dark relative overflow-hidden rounded-[24px] border px-5 py-3 flex items-center justify-between gap-3"
                            style={{
                                background: "hsl(var(--ink) / 0.96)",
                                color: "hsl(var(--cream))",
                                borderColor: "hsl(var(--cream) / 0.15)",
                                boxShadow:
                                    "0 24px 40px -24px hsl(0 93% 60% / 0.45), var(--shadow-lifted, 0 12px 40px hsl(var(--ink) / 0.18))",
                            }}
                        >
                            <div
                                aria-hidden
                                className="grain pointer-events-none absolute inset-0 opacity-40"
                            />
                            <div className="relative min-w-0">
                                <p
                                    className="overline"
                                    style={{ color: "hsl(var(--butter))" }}
                                >
                                    § Your dossier
                                </p>
                                <p className="m-0 text-sm text-cream/85 truncate">
                                    Visitors see this page.
                                </p>
                            </div>
                            <Link
                                href={`/dashboard/${id}`}
                                className="btn-pill relative group shrink-0"
                                style={{
                                    background: "hsl(var(--tomato))",
                                    color: "hsl(var(--cream))",
                                }}
                            >
                                Edit on dashboard
                                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
