// app/profile/[id]/page.tsx
//
// Phase 3c (capricciosa-61151): restyled to pizzadao.org look.
// Ink hero band with cream typography, butter level pill, tomato CTA,
// cream-warm card surfaces, semantic dividers (border-rule).
// See plans/site-restyle-pizzadao-org.md.
"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TURTLES } from "../../ui/constants";
import { NFTCollection } from "../../ui/nft";
import { POAPCollection } from "../../ui/poap";
import { ProfileLinksDisplay } from "../../ui/profile-links";
import { AttendanceCard } from "../../ui/attendance-card";
import { MafiaRankBadge } from "../../ui/mafia-points/MafiaRankBadge";
import { UnlockTicketCard } from "../../ui/unlock-ticket-card";
import { AddVouchButton } from "../../ui/vouches/AddVouchButton";
import { btn } from "../../ui/onboarding/styles";
import {
    useProfile,
    usePfp,
    useXAccount,
    useArticlesByMember,
    useMissionProgress,
    useMe,
    useCrewMappings,
    useMyTasks,
} from "../../lib/hooks/use-api";

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

function CollapsibleSection({
    title,
    defaultOpen = false,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-t border-rule pt-4">
            <button
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-2 bg-transparent border-0 p-0 text-left text-foreground font-display text-lg font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                aria-expanded={open}
            >
                <span
                    className="inline-block text-muted-foreground text-[10px] transition-transform duration-200"
                    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                    aria-hidden
                >
                    ▶
                </span>
                {title}
            </button>
            {open && <div className="mt-3">{children}</div>}
        </div>
    );
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    const { data, isLoading: loading, error } = useProfile(id);
    const { data: pfpData } = usePfp(id);
    const { data: xAccount } = useXAccount(id);
    const { data: articlesData } = useArticlesByMember(id);
    const { data: missionProgress } = useMissionProgress(id);
    const { data: meData } = useMe();
    const { data: crewData } = useCrewMappings();
    const { data: tasksData } = useMyTasks(id);

    const pfpUrl = pfpData?.url ?? null;
    const articles: { slug: string; title: string; excerpt?: string; publishedAt?: string }[] =
        articlesData?.articles ?? [];
    const missionLevel = missionProgress?.currentLevel ? missionProgress : null;
    const currentMemberId = meData?.memberId ?? null;
    const crewOptions: CrewOption[] = (crewData?.crews ?? []).map((c: any) => ({
        id: String(c?.id ?? ""),
        label: norm(c?.label ?? ""),
        turtles: splitTurtlesCell(c?.turtles),
        emoji: norm(c?.emoji) || undefined,
        callTime: norm(c?.callTime) || undefined,
        callTimeUrl: norm(c?.callTimeUrl) || undefined,
        callLength: norm(c?.callLength) || undefined,
    }));
    const myTasks: Record<string, { label: string; url?: string }[]> = tasksData?.tasksByCrew ?? {};
    const doneCounts = tasksData?.doneCountsByCrew ?? {};

    if (loading) {
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
                        {error?.message || "This member doesn't exist."}
                    </p>
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
    const turtleList = (Array.isArray(rawTurtles)
        ? rawTurtles
        : String(rawTurtles).split(",").map((t) => t.trim())
    ).filter(Boolean);

    const userCrews = (crewsStr !== "None"
        ? crewsStr.split(",").map((c: string) => c.trim()).filter(Boolean)
        : []) as string[];

    const levelNum = missionLevel && missionLevel.approvedCount > 0
        ? (missionLevel.currentLevel > 8 ? "MAX" : missionLevel.currentLevel)
        : null;
    const levelTitle = missionLevel?.levelTitle || "";

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-3xl px-5 py-6 grid gap-5">
                {/* Back Button */}
                <div>
                    <button
                        onClick={() => router.back()}
                        className="bg-transparent border-0 p-0 text-base font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                        ← Back
                    </button>
                </div>

                {/* Ink hero card — compact, dark, cream type */}
                <section className="rounded-[--radius] bg-ink text-cream border border-cream/15 shadow-sm overflow-hidden">
                    <div className="p-5 sm:p-6 flex items-center gap-4">
                        {pfpUrl && (
                            <img
                                src={pfpUrl}
                                alt={`${name}'s profile`}
                                className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover shrink-0"
                                style={{
                                    objectPosition: "top",
                                    border: "3px solid hsl(var(--cream))",
                                    boxShadow: "0 2px 12px hsl(0 0% 0% / 0.25)",
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                }}
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="m-0 font-display font-bold text-3xl sm:text-4xl text-cream [text-wrap:balance] break-words leading-[1.05]">
                                    {name}
                                </h1>
                                <MafiaRankBadge memberId={idValue} />
                            </div>
                            <div className="mt-1 text-sm text-cream/70">
                                {city}
                            </div>
                        </div>
                        <div className="shrink-0">
                            <AddVouchButton
                                targetMemberId={idValue}
                                currentMemberId={currentMemberId}
                            />
                        </div>
                    </div>

                    {/* Level / PEP stripe — butter accent */}
                    {levelNum !== null && (
                        <Link
                            href="/missions"
                            className="block border-t border-cream/15 px-5 sm:px-6 py-4 hover:bg-cream/5 transition-colors group"
                        >
                            <div className="flex items-baseline gap-3 flex-wrap">
                                <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-cream/60">
                                    Level
                                </span>
                                <span
                                    className="font-display font-bold text-4xl sm:text-5xl leading-none"
                                    style={{ color: "hsl(var(--butter))" }}
                                >
                                    {levelNum}
                                </span>
                                {levelTitle && (
                                    <span className="font-display text-lg sm:text-xl text-cream/85 group-hover:text-cream transition-colors">
                                        {levelTitle}
                                    </span>
                                )}
                            </div>
                        </Link>
                    )}
                </section>

                {/* Main Card — cream-warm surface for the rest of the profile */}
                <section
                    className="grid gap-4 rounded-[--radius] border border-rule p-5 sm:p-6 shadow-sm"
                    style={{
                        background: "hsl(var(--card))",
                        color: "hsl(var(--card-foreground))",
                    }}
                >
                    {/* Crews Section */}
                    {userCrews.length > 0 && (
                        <div>
                            <h3 className="mt-0 mb-3 font-display text-lg font-semibold text-foreground">
                                Crews
                            </h3>
                            <div
                                className="grid gap-2.5"
                                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
                            >
                                {userCrews.map((crewName) => {
                                    const c = crewOptions.find(
                                        (opt) =>
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
                                            className="rounded-[--radius] border border-rule p-3"
                                            style={{ background: "hsl(var(--background))" }}
                                        >
                                            <Link
                                                href={`/crew/${c?.id || crewName.toLowerCase().replace(/\s+/g, "_")}`}
                                                className="font-display font-semibold text-foreground no-underline hover:text-tomato transition-colors"
                                            >
                                                {emoji} {label}
                                            </Link>

                                            {/* Closed count */}
                                            {doneCount > 0 && (
                                                <div
                                                    className="mt-2 text-[11px] font-bold uppercase tracking-wider"
                                                    style={{ color: "hsl(142 71% 35%)" }}
                                                >
                                                    Closed: {doneCount}
                                                </div>
                                            )}

                                            {/* Claimed tasks */}
                                            {tasks.length > 0 && (
                                                <div className="mt-2">
                                                    <div className="text-[11px] font-bold uppercase tracking-wider text-tomato mb-1">
                                                        Claimed Tasks
                                                    </div>
                                                    {tasks.slice(0, 3).map((t, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="text-xs flex items-baseline gap-1 mt-0.5"
                                                        >
                                                            <span className="text-tomato">•</span>
                                                            {t.url ? (
                                                                <a
                                                                    href={t.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-foreground underline underline-offset-2 hover:text-tomato transition-colors"
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

                    {/* Articles */}
                    {articles.length > 0 && (
                        <div className="border-t border-rule pt-4">
                            <h3 className="mt-0 mb-3 font-display text-lg font-semibold text-foreground">
                                Articles
                            </h3>
                            <div className="grid gap-2">
                                {articles.map((a) => (
                                    <Link
                                        key={a.slug}
                                        href={`/articles/${a.slug}`}
                                        className="block rounded-[--radius] border border-rule p-3 no-underline text-foreground hover:border-tomato/40 transition-colors"
                                        style={{ background: "hsl(var(--background))" }}
                                    >
                                        <div className="font-display font-semibold text-base">{a.title}</div>
                                        {a.excerpt && (
                                            <div className="mt-1 text-sm text-muted-foreground">
                                                {a.excerpt}
                                            </div>
                                        )}
                                        {a.publishedAt && (
                                            <div className="mt-1 text-[11px] text-muted-foreground opacity-70">
                                                {new Date(a.publishedAt).toLocaleDateString("en-US", {
                                                    year: "numeric",
                                                    month: "short",
                                                    day: "numeric",
                                                })}
                                            </div>
                                        )}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Attendance Card */}
                    <AttendanceCard memberId={idValue} />

                    {/* Collapsible About */}
                    <CollapsibleSection title="About" defaultOpen={false}>
                        <div className="grid gap-6 sm:grid-cols-2">
                            <StatItem label="Status" value={status || "—"} />
                            <StatItem label="ID" value={`#${idValue}`} />
                            {orgs && <StatItem label="Orgs" value={orgs} />}
                            {skills && <StatItem label="Skills" value={skills} />}

                            {/* X Account */}
                            {xAccount?.connected && (
                                <div>
                                    <h3 className="m-0 mb-1.5 text-xs uppercase tracking-wider font-bold text-muted-foreground">
                                        X
                                    </h3>
                                    <a
                                        href={`https://x.com/${xAccount.username}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 text-lg font-medium text-foreground no-underline hover:text-tomato hover:underline transition-colors"
                                    >
                                        @{xAccount.username}
                                        <svg
                                            width={14}
                                            height={14}
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            style={{ opacity: 0.4 }}
                                        >
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                    </a>
                                </div>
                            )}

                            {/* Roles */}
                            <div className="sm:col-span-2">
                                <h3 className="m-0 mb-1.5 text-xs uppercase tracking-wider font-bold text-muted-foreground">
                                    Roles
                                </h3>
                                <div className="flex flex-wrap items-center gap-2">
                                    {turtleList.length > 0 ? (
                                        turtleList.map((tName: string) => {
                                            const tDef = TURTLES.find(
                                                (t) =>
                                                    t.id.toLowerCase() === tName.toLowerCase() ||
                                                    t.label.toLowerCase() === tName.toLowerCase()
                                            );
                                            if (!tDef) return null;
                                            return (
                                                <Link
                                                    key={tDef.id}
                                                    href={`/turtles/${encodeURIComponent(tDef.id)}`}
                                                    title={`View all ${tDef.label} members`}
                                                    className="hover:opacity-80 transition-opacity"
                                                >
                                                    <img
                                                        src={tDef.image}
                                                        alt={tDef.label}
                                                        style={{
                                                            width: 40,
                                                            height: 40,
                                                            objectFit: "contain",
                                                        }}
                                                    />
                                                </Link>
                                            );
                                        })
                                    ) : (
                                        <span className="text-lg font-medium text-muted-foreground">
                                            None
                                        </span>
                                    )}
                                </div>

                                {(() => {
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
                                        if (
                                            TURTLES.find(
                                                (t) =>
                                                    t.id.toLowerCase() === nameLower ||
                                                    t.label.toLowerCase() === nameLower
                                            )
                                        ) {
                                            return false;
                                        }
                                        if (hiddenRoles.has(nameLower)) {
                                            return false;
                                        }
                                        return true;
                                    });
                                    if (otherRoles.length === 0) return null;
                                    return (
                                        <div className="mt-2 text-sm text-muted-foreground">
                                            <strong className="text-foreground">Other Roles:</strong>{" "}
                                            {otherRoles.join(", ")}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Profile Links */}
                            <ProfileLinksDisplay memberId={idValue} />
                        </div>
                    </CollapsibleSection>

                    {/* Collapsible Collections */}
                    <CollapsibleSection title="Collections" defaultOpen={false}>
                        <div className="grid gap-4">
                            <POAPCollection memberId={idValue} />
                            <NFTCollection memberId={idValue} showConnectPrompt={false} />
                            <UnlockTicketCard memberId={idValue} />
                        </div>
                    </CollapsibleSection>
                </section>

                {/* Footer */}
                <div className="text-center mt-10 text-sm text-muted-foreground opacity-60 font-display">
                    PizzaDAO
                </div>
            </div>
        </div>
    );
}

function StatItem({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <h3 className="m-0 mb-1.5 text-xs uppercase tracking-wider font-bold text-muted-foreground">
                {label}
            </h3>
            <p className="m-0 text-lg font-medium text-foreground break-words">{value}</p>
        </div>
    );
}
