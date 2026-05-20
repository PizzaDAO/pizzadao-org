// app/profile/[id]/page.tsx
//
// Plan: truffle-91035 (PR2 — pepperoni-77692). The page is now a thin
// composition of components from app/ui/profile/. Owner-vs-visitor mode
// is driven from useProfileSummary; ProfileActions renders the role-
// appropriate primary CTA; vouches are promoted into the social-proof
// tier; collections are collapsed + lazy. Visual treatment continues to
// use the existing cream/ink/tomato/butter tokens — a Lovable port-back
// will re-skin later (PR5).
//
// Server-component wrapper for OG metadata is deferred to PR3
// (`/api/profile-summary/[id]` aggregator + generateMetadata).
"use client";

import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProfileHero } from "../../ui/profile/ProfileHero";
import { AboutChips } from "../../ui/profile/AboutChips";
import { CrewChipRow, type CrewOption } from "../../ui/profile/CrewChipRow";
import { ContributionsBlock } from "../../ui/profile/ContributionsBlock";
import { CollectionsLazy } from "../../ui/profile/CollectionsLazy";
import { AttendanceCard } from "../../ui/attendance-card";
import { useProfileSummary } from "../../lib/hooks/use-api";
import { btn } from "../../ui/onboarding/styles";

function norm(s: unknown) {
    return String(s ?? "").trim().replace(/\s+/g, " ");
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
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
                    <p className="text-lg text-muted-foreground">Loading profile...</p>
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
                <div className="grid gap-3 rounded-[--radius] border border-rule bg-card text-card-foreground p-6 shadow-sm max-w-md w-full">
                    <h1 className="text-2xl font-display font-bold m-0 [text-wrap:balance]">
                        Profile Not Found
                    </h1>
                    <p className="text-muted-foreground mb-4">
                        {(error as Error | undefined)?.message || "This member doesn't exist."}
                    </p>
                    <button onClick={() => router.back()} style={btn("primary")}>
                        ← Go Back
                    </button>
                </div>
            </div>
        );
    }

    const mode = data.isOwner && !asVisitor ? "owner-readonly" : "public";

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
            <div className="mx-auto max-w-3xl px-5 py-6 grid gap-5">
                {/* Back */}
                <div>
                    <button
                        onClick={() => router.back()}
                        className="bg-transparent border-0 p-0 text-base font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
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
                    className="rounded-[--radius] border border-rule p-5 sm:p-6 shadow-sm"
                    style={{
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                    }}
                >
                    <AttendanceCard memberId={id} variant="inline" />
                </section>

                <CollectionsLazy memberId={id} />

                <div className="text-center mt-6 text-sm text-muted-foreground opacity-60 font-display">
                    PizzaDAO
                </div>
            </div>
        </div>
    );
}
