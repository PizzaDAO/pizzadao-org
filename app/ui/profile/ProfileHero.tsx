"use client";

// app/ui/profile/ProfileHero.tsx
//
// Shared hero for /profile/[id]. Plan: truffle-91035 (PR2 — pepperoni-77692).
// Owns: PFP, name h1, tagline placeholder (the actual tagline DB field lands
// in PR4 — for now the prop is accepted but rendered blank when empty), the
// identity line (city · level · mafia rank), and the primary-action slot
// (ProfileActions). Owner banner above the hero is rendered here too because
// it's part of the hero visual rhythm.

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

    const identityParts: React.ReactNode[] = [];
    if (city) identityParts.push(<span key="city">{city}</span>);
    if (level !== null && level !== undefined && level !== "") {
        identityParts.push(
            <Link
                key="level"
                href="/missions"
                className="text-cream/85 hover:text-cream transition-colors no-underline"
            >
                Lv. {level}
                {levelTitle ? ` · ${levelTitle}` : ""}
            </Link>,
        );
    }
    if (mafiaRank) {
        identityParts.push(
            <span key="mafia" style={{ color: "hsl(var(--butter))" }}>
                {mafiaRank}
            </span>,
        );
    }

    return (
        <div className="grid gap-3">
            {bannerVisible && (
                <div
                    role="status"
                    className="rounded-[--radius] border border-rule p-3 text-sm flex items-start gap-3"
                    style={{
                        background: "hsl(var(--butter) / 0.20)",
                        color: "hsl(var(--ink))",
                    }}
                >
                    <span className="flex-1">
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
                        className="text-ink/60 hover:text-ink cursor-pointer text-base leading-none"
                    >
                        ×
                    </button>
                </div>
            )}

            <section className="rounded-[--radius] bg-ink text-cream border border-cream/15 shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 flex items-start gap-4">
                    {pfpUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
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
                        <h1 className="m-0 font-display font-bold text-3xl sm:text-4xl text-cream [text-wrap:balance] break-words leading-[1.05]">
                            {name}
                        </h1>

                        {tagline && tagline.trim().length > 0 && (
                            <p className="mt-1.5 text-sm sm:text-base text-cream/85 m-0 [text-wrap:balance]">
                                {tagline}
                            </p>
                        )}

                        {identityParts.length > 0 && (
                            <div className="mt-2 text-sm text-cream/70 flex flex-wrap items-center gap-x-2 gap-y-1">
                                {identityParts.map((node, i) => (
                                    <span key={i} className="flex items-center gap-2">
                                        {i > 0 && <span aria-hidden className="text-cream/40">·</span>}
                                        {node}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <ProfileActions
                        memberId={memberId}
                        mode={mode}
                        viewerId={viewerId}
                    />
                </div>
            </section>
        </div>
    );
}
