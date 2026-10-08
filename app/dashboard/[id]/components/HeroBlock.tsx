// app/dashboard/[id]/components/HeroBlock.tsx
//
// tomato-30368 — Editorial restyle. Borrows the wizard's print-shop vocabulary:
// overline (§ 01 · the file), clamp() display headline, handwritten margin
// annotation, paper-soft chrome on the avatar, btn-pill CTAs, and a warm
// radial spotlight. Props/callbacks unchanged — same name/pfp/level/city/PEP
// inputs, same `onSendPep` callback, same routes for Edit Profile and
// Manage Wallets, same ThemeToggle + NotificationBell footer.
"use client";

import Link from "next/link";
import { ArrowUpRight, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PepAmount } from "../../../ui/economy";
import { NotificationBell } from "../../../ui/notifications";
import { ThemeToggle } from "../../../ui/ThemeToggle";
import type { ProfileCompletion } from "../lib/profile-completion";
import { ProfileCompletionMeter } from "./ProfileCompletionMeter";

export type HeroBlockProps = {
    name: string;
    pfpUrl: string | null;
    /** Optional mission-level badge data. Equivalent to the original `missionLevel`. */
    levelBadge?: { level: number; title: string } | null;
    pepBalance: number | null;
    city: string;
    idValue: string;
    /** Alias retained for the plan's prop name; behaves the same as `levelBadge`. */
    missionLevel?: { level: number; title: string } | null;
    onSendPep: () => void;
    /** Optional override for the Edit Profile click. When omitted, the rendered
     * Link navigates to `/profile/{idValue}/edit` (the new owner-only edit
     * route introduced in PR5 slice-61816). */
    onOpenEditProfile?: () => void;
    /** jalapeno-34126 — setup checklist; the meter hides itself when complete. */
    profileCompletion?: ProfileCompletion | null;
};

function initialsOf(name: string): string {
    return (
        name
            .replace(/["'""]/g, "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? "")
            .join("") || "—"
    );
}

export function HeroBlock({
    name,
    pfpUrl,
    levelBadge,
    pepBalance,
    city,
    idValue,
    missionLevel,
    onSendPep,
    profileCompletion,
}: HeroBlockProps) {
    // Either prop name works; prefer levelBadge if both supplied.
    const badge = levelBadge ?? missionLevel ?? null;
    const initials = initialsOf(name);
    const t = useTranslations("dashboard.hero");
    const format = useFormatter();

    return (
        <header className="relative fade-up">
            {/* Hero spotlight backdrop */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-[40svh] opacity-70"
                style={{
                    background:
                        "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.09), transparent 65%)",
                }}
            />

            {/* ── Top utility row — chrome controls float free of the headline */}
            <div className="flex items-center justify-between gap-3">
                <p className="overline text-tomato-readable">{t("overline")}</p>
                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <NotificationBell />
                </div>
            </div>

            {/* ── Identity row — portrait + name + meta */}
            <div className="mt-5 flex flex-wrap items-start gap-5 md:gap-6">
                {/* Portrait */}
                <div className="relative shrink-0">
                    {pfpUrl ? (
                        <img
                            src={pfpUrl}
                            alt={t("pfpAlt", { name })}
                            className="grain relative h-[88px] w-[88px] rounded-full object-cover md:h-[104px] md:w-[104px]"
                            style={{
                                objectPosition: "top",
                                border: "1.5px solid hsl(var(--rule-warm) / 0.55)",
                                boxShadow: "var(--shadow-soft)",
                                imageRendering: "crisp-edges",
                                background: "hsl(var(--card))",
                            }}
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                            }}
                        />
                    ) : (
                        <div
                            className="grain relative grid h-[88px] w-[88px] place-items-center rounded-full md:h-[104px] md:w-[104px]"
                            style={{
                                border: "1.5px dashed hsl(var(--foreground) / 0.35)",
                                background: "hsl(var(--background) / 0.6)",
                                color: "hsl(var(--foreground) / 0.75)",
                                boxShadow: "var(--shadow-soft)",
                            }}
                        >
                            <span className="font-[family-name:var(--font-display)] text-[22px] font-black tracking-tight">
                                {initials}
                            </span>
                        </div>
                    )}
                    <span
                        aria-hidden
                        className="handwritten pointer-events-none absolute -bottom-3 -right-2 rotate-[-6deg] text-tomato-readable"
                        style={{ fontSize: 15 }}
                    >
                        #{idValue}
                    </span>
                </div>

                {/* Name + level + city + PEP */}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                        <Link
                            href={`/profile/${idValue}`}
                            className="font-[family-name:var(--font-display)] font-black tracking-[-0.02em] text-foreground transition-colors hover:text-tomato-readable"
                            style={{
                                fontSize: "clamp(2rem, 5vw, 3.25rem)",
                                lineHeight: 0.95,
                                textWrap: "balance",
                                textDecoration: "none",
                            }}
                        >
                            {name}
                        </Link>
                        {badge && (
                            <span
                                className="ui inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold uppercase tracking-[0.08em]"
                                style={{
                                    background: "hsl(var(--butter) / 0.30)",
                                    color: "hsl(var(--ink))",
                                    border: "1px solid hsl(var(--butter) / 0.55)",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {t("levelBadge", { level: badge.level })}
                                {badge.title ? ` · ${badge.title}` : ""}
                            </span>
                        )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                        <span className="ui text-[13px] uppercase tracking-[0.08em] text-foreground/70">
                            {city}
                        </span>
                        <span aria-hidden className="text-foreground/30">
                            ·
                        </span>
                        <span
                            className="inline-flex items-center gap-1 font-semibold text-tomato-readable"
                            style={{ fontSize: 14 }}
                        >
                            {pepBalance !== null ? (
                                <PepAmount amount={format.number(pepBalance)} size={14} />
                            ) : (
                                "—"
                            )}
                        </span>
                        <button
                            onClick={onSendPep}
                            aria-label={t("sendPep")}
                            title={t("sendPep")}
                            className="ui inline-flex items-center justify-center rounded-full transition-colors hover:bg-tomato/10"
                            style={{
                                // sicilian-41551: 44px tap target, smaller visual icon
                                minWidth: 44,
                                minHeight: 44,
                                padding: 12,
                                background: "transparent",
                                border: "1px solid transparent",
                                color: "hsl(var(--muted-foreground))",
                                cursor: "pointer",
                                marginLeft: -8,
                            }}
                        >
                            <Send size={14} aria-hidden />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Primary action row — pill CTAs */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                    href={`/profile/${idValue}/edit`}
                    className="btn-pill group"
                    style={{
                        background: "hsl(var(--tomato))",
                        color: "hsl(var(--cream))",
                        boxShadow: "var(--shadow-soft)",
                        textDecoration: "none",
                    }}
                >
                    {t("editProfile")}
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
                <Link
                    href="/me/wallets"
                    className="ui inline-flex items-center gap-1.5 text-[13px] uppercase tracking-[0.08em] text-foreground/70 transition-colors hover:text-tomato-readable"
                    style={{
                        textDecoration: "none",
                        minHeight: 32,
                    }}
                >
                    {t("manageWallets")}
                    <ArrowUpRight className="h-3 w-3" />
                </Link>
            </div>

            {/* ── Profile setup meter (hidden once complete) */}
            <ProfileCompletionMeter completion={profileCompletion} />
        </header>
    );
}
