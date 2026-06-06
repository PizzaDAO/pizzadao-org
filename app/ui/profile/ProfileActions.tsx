"use client";

// app/ui/profile/ProfileActions.tsx
//
// Profile page primary action + kebab menu.
//
// Plan: truffle-91035 (PR2 — pepperoni-77692). The hero used to expose
// nothing for the profile owner and only a vouch button for visitors.
// This component renders the role-appropriate primary CTA plus a kebab
// for Share / Copy link / Send PEP — matching the IA tree in §4 of the
// plan.
//
// onion-47612: editorial restyle. Visitor sign-in CTA uses .btn-pill;
// the owner-mode inline CTA is suppressed because /profile/[id]'s sticky
// bottom dock now carries the "Edit on dashboard" affordance (avoids two
// copies in the hero). Vouch button is sourced from AddVouchButton —
// left untouched (lives across owner & visitor flows).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AddVouchButton } from "../vouches/AddVouchButton";
import { SendPepModal } from "../economy/SendPepModal";

export type ProfileActionsMode = "public" | "owner-readonly" | "owner-edit";

interface ProfileActionsProps {
    memberId: string;
    mode: ProfileActionsMode;
    viewerId: string | null;
    /** When true, hide the kebab "Send PEP" item (e.g., self-view doesn't need it). */
    hideSendPep?: boolean;
}

export function ProfileActions({
    memberId,
    mode,
    viewerId,
    hideSendPep,
}: ProfileActionsProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [pepOpen, setPepOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Close menu on outside click / escape
    useEffect(() => {
        if (!menuOpen) return;
        function onDocClick(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setMenuOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [menuOpen]);

    const profileUrl =
        typeof window !== "undefined" ? `${window.location.origin}/profile/${memberId}` : `/profile/${memberId}`;

    async function handleShare() {
        setMenuOpen(false);
        if (typeof navigator !== "undefined" && (navigator as any).share) {
            try {
                await (navigator as any).share({ url: profileUrl });
                return;
            } catch {
                // user cancelled or share unsupported — fall back to copy
            }
        }
        await handleCopy();
    }

    async function handleCopy() {
        setMenuOpen(false);
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                await navigator.clipboard.writeText(profileUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
            }
        } catch {
            // ignore — clipboard may be blocked
        }
    }

    // Primary CTA
    let primary: React.ReactNode = null;
    const isOwner = mode === "owner-readonly" || mode === "owner-edit";
    const isSelf = !!viewerId && viewerId === memberId;

    if (isOwner) {
        // onion-47612: the sticky editorial bottom dock on /profile/[id]
        // carries the "Edit on dashboard" CTA, so we suppress the inline
        // hero copy. The kebab still shows for Share/Copy.
        primary = null;
    } else if (viewerId && !isSelf) {
        primary = (
            <AddVouchButton
                targetMemberId={memberId}
                currentMemberId={viewerId}
            />
        );
    } else if (!viewerId) {
        const returnTo = encodeURIComponent(`/profile/${memberId}`);
        primary = (
            <a
                href={`/api/discord/login?returnTo=${returnTo}`}
                className="btn-pill"
                style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                }}
            >
                Sign in to vouch
            </a>
        );
    }

    return (
        <div className="flex items-center gap-2 shrink-0" ref={menuRef}>
            {primary}

            {/* Kebab — pill-shaped to match the editorial vocabulary */}
            <div className="relative">
                <button
                    type="button"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                    style={{
                        background: "transparent",
                        color: "hsl(var(--cream) / 0.85)",
                        border: "1px solid hsl(var(--cream) / 0.28)",
                    }}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden
                    >
                        <circle cx="8" cy="3" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                    </svg>
                </button>

                {menuOpen && (
                    <div
                        role="menu"
                        className="paper-soft absolute right-0 mt-2 z-20 min-w-[200px] rounded-[16px] border shadow-lg overflow-hidden"
                        style={{
                            background: "hsl(var(--card))",
                            color: "hsl(var(--card-foreground))",
                            borderColor: "hsl(var(--rule-warm) / 0.55)",
                        }}
                    >
                        <p
                            className="overline px-3 pt-3 pb-1 text-foreground/55"
                            aria-hidden
                        >
                            § More
                        </p>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={handleShare}
                            className="block w-full text-left px-3 py-3 min-h-11 text-sm hover:bg-tomato/10 cursor-pointer"
                        >
                            Share
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={handleCopy}
                            className="block w-full text-left px-3 py-3 min-h-11 text-sm hover:bg-tomato/10 cursor-pointer"
                        >
                            {copied ? "Copied!" : "Copy link"}
                        </button>
                        {!hideSendPep && viewerId && !isSelf && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setMenuOpen(false);
                                    setPepOpen(true);
                                }}
                                className="block w-full text-left px-3 py-3 min-h-11 text-sm hover:bg-tomato/10 cursor-pointer"
                            >
                                Send PEP
                            </button>
                        )}
                        {isOwner && (
                            <Link
                                href={`/dashboard/${memberId}`}
                                role="menuitem"
                                className="block w-full text-left px-3 py-3 min-h-11 text-sm hover:bg-tomato/10 cursor-pointer no-underline text-foreground"
                                onClick={() => setMenuOpen(false)}
                            >
                                Edit on dashboard →
                            </Link>
                        )}
                    </div>
                )}
            </div>

            <SendPepModal
                open={pepOpen}
                onClose={() => setPepOpen(false)}
                currentMemberId={viewerId ?? undefined}
            />
        </div>
    );
}
