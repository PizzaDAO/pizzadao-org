"use client";

// app/ui/profile/ProfileHero.tsx
//
// Shared hero for /profile/[id]. Plan: truffle-91035 (PR2 — pepperoni-77692).
// Owns: PFP, name h1, tagline placeholder (the actual tagline DB field lands
// in PR4 — for now the prop is accepted but rendered blank when empty), the
// identity line (city · level · mafia rank), and the primary-action slot
// (ProfileActions). Owner banner above the hero is rendered here too because
// it's part of the hero visual rhythm.
//
// onion-47612: editorial restyle. The hero is now an "ink band" with
// paper-soft + grain textures, "§ 01 · The dossier" overline, display-
// font name with clamp(), and a handwritten margin annotation tucked
// beside the level pill. Props are unchanged.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProfileActions, type ProfileActionsMode } from "./ProfileActions";

interface ProfileHeroProps {
    memberId: string;
    name: string;
    pfpUrl?: string | null;
    /** Free-form one-liner. PR4 wires this to a DB field; pass "" or undefined for now. */
    tagline?: string | null;
    city?: string | null;
    /** Numeric mission level (1–8), "MAX" for >8, or null if no level. */
    level?: number | string | null;
    levelTitle?: string | null;
    mafiaRank?: string | null;
    mode: ProfileActionsMode;
    viewerId: string | null;
    /** When true, suppress the owner banner (used when ?as=visitor is set). */
    suppressOwnerBanner?: boolean;
}

const OWNER_BANNER_KEY = "profile-owner-banner-seen";

// Light spotlight + warm ink-bleed behind the headline.
const HERO_SPOTLIGHT_STYLE: React.CSSProperties = {
    background:
        "radial-gradient(80% 60% at 18% 0%, hsl(46 100% 62% / 0.18), transparent 60%), radial-gradient(70% 60% at 95% 12%, hsl(0 93% 60% / 0.16), transparent 65%)",
};

export function ProfileHero({
    memberId,
    name,
    pfpUrl,
    tagline,
    city,
    level,
    levelTitle,
    mafiaRank,
    mode,
    viewerId,
    suppressOwnerBanner,
}: ProfileHeroProps) {
    const isOwner = mode === "owner-readonly" || mode === "owner-edit";

    const [bannerVisible, setBannerVisible] = useState(false);
    useEffect(() => {
        if (!isOwner || suppressOwnerBanner) {
            setBannerVisible(false);
            return;
        }
        try {
            const seen = window.localStorage.getItem(OWNER_BANNER_KEY);
            setBannerVisible(seen !== "1");
        } catch {
            setBannerVisible(true);
        }
    }, [isOwner, suppressOwnerBanner]);

    function dismissBanner() {
        setBannerVisible(false);
        try {
            window.localStorage.setItem(OWNER_BANNER_KEY, "1");
        } catch {
            // ignore — storage may be unavailable
        }
    }

    const hasLevel = level !== null && level !== undefined && level !== "";

    return (
        <div className="grid gap-3">
            {bannerVisible && (
                <div
                    role="status"
                    className="paper-soft rounded-[18px] border p-3 text-sm flex items-start gap-3"
                    style={{
                        background: "hsl(var(--butter) / 0.22)",
                        color: "hsl(var(--ink))",
                        borderColor: "hsl(var(--rule-warm) / 0.55)",
                    }}
                >
                    <span className="flex-1 relative">
                        <strong className="font-display font-bold">This is your public profile</strong>
                        {" "}— visitors see this. Manage on{" "}
                        <Link href={`/dashboard/${memberId}`} className="underline underline-offset-2 hover:text-tomato">
                            dashboard
                        </Link>
                        .
                    </span>
                    <button
                        type="button"
                        onClick={dismissBanner}
                        aria-label="Dismiss"
                        /* sicilian-41551: 44x44 tap target. */
                        className="relative inline-flex h-11 w-11 -m-2 items-center justify-center text-ink/60 hover:text-ink cursor-pointer text-base leading-none"
                    >
                        ×
                    </button>
                </div>
            )}

            {/*
              onion-47612 ink hero band.
              Visually echoes the welcome-step CTA dock (paper-soft-dark
              over ink) but carries the member's full identity.

              sicilian-41551 mobile layout:
              • <sm: actions wrap to a second row below the name so the
                Vouch CTA isn't squeezed between an 80px PFP and a kebab
                at 375px viewports.
              • Name uses `break-words` + `[overflow-wrap:anywhere]` so long
                mafia names like "Pepperoni-Pesto-Provolone Pancetta"
                don't break the layout.
            */}
            <section
                className="paper-soft-dark relative overflow-hidden rounded-[28px] border"
                style={{
                    background: "hsl(var(--ink) / 0.97)",
                    color: "hsl(var(--cream))",
                    borderColor: "hsl(var(--cream) / 0.15)",
                    boxShadow:
                        "0 30px 60px -30px hsl(0 93% 60% / 0.45), var(--shadow-lifted, 0 12px 40px hsl(var(--ink) / 0.2))",
                }}
            >
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-80"
                    style={HERO_SPOTLIGHT_STYLE}
                />
                <div
                    aria-hidden
                    className="grain pointer-events-none absolute inset-0 opacity-50"
                />

                <div className="relative p-5 sm:p-7 flex items-start gap-4 flex-wrap sm:flex-nowrap">
                    {pfpUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={pfpUrl}
                            alt={`${name}'s profile`}
                            className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover shrink-0"
                            style={{
                                objectPosition: "top",
                                border: "3px solid hsl(var(--cream))",
                                boxShadow: "0 2px 12px hsl(0 0% 0% / 0.35)",
                                transform: "rotate(-2deg)",
                            }}
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                            }}
                        />
                    )}

                    <div className="flex-1 min-w-0 relative">
                        <p
                            className="overline"
                            style={{ color: "hsl(var(--butter))" }}
                        >
                            § 01 · The dossier
                        </p>

                        <h1
                            className="font-[family-name:var(--font-display)] m-0 mt-2 font-black tracking-[-0.015em] text-cream [text-wrap:balance] break-words"
                            style={{
                                fontSize: "clamp(2rem, 6.5vw, 3.75rem)",
                                lineHeight: 0.95,
                                overflowWrap: "anywhere",
                            }}
                        >
                            {name}
                        </h1>

                        {tagline && tagline.trim().length > 0 && (
                            <p
                                className="m-0 mt-3 text-cream/85 [text-wrap:balance]"
                                style={{ fontSize: "15px", lineHeight: 1.55 }}
                            >
                                {tagline}
                            </p>
                        )}

                        {(city || hasLevel || mafiaRank) && (
                            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-cream/75 relative">
                                {city && (
                                    <span className="inline-flex items-center gap-2">
                                        {city}
                                    </span>
                                )}
                                {city && (hasLevel || mafiaRank) && (
                                    <span aria-hidden className="text-cream/35">·</span>
                                )}
                                {hasLevel && (
                                    <span className="inline-flex items-center gap-2 relative">
                                        <Link
                                            href="/missions"
                                            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-cream/90 hover:text-cream no-underline transition-colors"
                                            style={{
                                                background: "hsl(var(--cream) / 0.08)",
                                                borderColor: "hsl(var(--cream) / 0.25)",
                                            }}
                                        >
                                            Lv. {level}
                                            {levelTitle ? ` · ${levelTitle}` : ""}
                                        </Link>
                                        {/* Handwritten margin annotation near the level pill */}
                                        <span
                                            aria-hidden
                                            className="handwritten pointer-events-none hidden sm:inline-block absolute -top-3 left-[calc(100%+8px)] rotate-[-4deg] whitespace-nowrap"
                                            style={{
                                                color: "hsl(var(--butter))",
                                                fontSize: 13,
                                                opacity: 0.85,
                                            }}
                                        >
                                            keep cooking
                                        </span>
                                    </span>
                                )}
                                {hasLevel && mafiaRank && (
                                    <span aria-hidden className="text-cream/35">·</span>
                                )}
                                {mafiaRank && (
                                    <span style={{ color: "hsl(var(--butter))" }}>
                                        {mafiaRank}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Wraps full-width below the name on phones, sits inline on >= sm. */}
                    <div className="w-full sm:w-auto sm:shrink-0 flex sm:justify-end relative">
                        <ProfileActions
                            memberId={memberId}
                            mode={mode}
                            viewerId={viewerId}
                        />
                    </div>
                </div>
            </section>
        </div>
    );
}
