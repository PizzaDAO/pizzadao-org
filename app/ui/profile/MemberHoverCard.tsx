"use client";

// app/ui/profile/MemberHoverCard.tsx
//
// Reusable hover card for any link to a member profile. Wrap the link (or avatar):
//
//   <MemberHoverCard memberId={id}><Link href={`/profile/${id}`}>Name</Link></MemberHoverCard>
//
// Hover or keyboard focus opens a small card (PFP, name, level / rank, crews, profile link) after
// a short delay; a long-press on touch opens it too (and swallows the click that follows so the
// press does not also navigate). Data comes from the public /api/public/member-card/[id]
// endpoint (public fields only), fetched on first open and cached for the session.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { isOptimizableImage } from "@/app/lib/image-hosts";
import { useLocale, useTranslations } from "next-intl";
import { formatMemberSince } from "@/app/lib/member-since-format";
import { DiscordActivityLine } from "./DiscordActivityBlock";
import type { MemberCard } from "@/app/api/public/member-card/[id]/route";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 120;
const LONG_PRESS_MS = 500;
const CARD_Z_INDEX = 1100; // above modals (1000), below celebration overlays (1900+)
const VIEWPORT_MARGIN = 8;
const CARD_GAP = 8;

type CardState = { status: "loading" } | { status: "error" } | { status: "ok"; card: MemberCard };

const cache = new Map<string, MemberCard>();
const inflight = new Map<string, Promise<MemberCard | null>>();

function loadCard(memberId: string): Promise<MemberCard | null> {
    const hit = cache.get(memberId);
    if (hit) return Promise.resolve(hit);
    let p = inflight.get(memberId);
    if (!p) {
        p = fetch(`/api/public/member-card/${encodeURIComponent(memberId)}`)
            .then((r) => (r.ok ? (r.json() as Promise<MemberCard>) : null))
            .then((card) => {
                if (card) cache.set(memberId, card);
                return card;
            })
            .catch(() => null)
            .finally(() => inflight.delete(memberId));
        inflight.set(memberId, p);
    }
    return p;
}

/** Test hook: forget fetched cards. */
export function clearMemberCardCache() {
    cache.clear();
    inflight.clear();
}

export function MemberHoverCard({
    memberId,
    children,
    className,
}: {
    memberId: string | null | undefined;
    children: React.ReactNode;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressed = useRef(false);
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const cardRef = useRef<HTMLSpanElement | null>(null);
    const cardId = useId();

    const clear = (r: { current: ReturnType<typeof setTimeout> | null }) => {
        if (r.current) clearTimeout(r.current);
        r.current = null;
    };
    const scheduleOpen = useCallback(() => {
        clear(closeTimer);
        if (open || openTimer.current) return;
        openTimer.current = setTimeout(() => {
            openTimer.current = null;
            setOpen(true);
        }, OPEN_DELAY_MS);
    }, [open]);
    const scheduleClose = useCallback(() => {
        clear(openTimer);
        clear(closeTimer);
        closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    }, []);

    useEffect(
        () => () => {
            clear(openTimer);
            clear(closeTimer);
            clear(pressTimer);
        },
        [],
    );

    // Escape closes; a tap outside closes (touch has no mouseleave).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        const onDown = (e: Event) => {
            const target = e.target as Node;
            if (rootRef.current?.contains(target) || cardRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onDown);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onDown);
        };
    }, [open]);

    if (!memberId) return <>{children}</>;

    return (
        <span
            ref={rootRef}
            className={`relative inline-block max-w-full ${className ?? ""}`}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onFocus={scheduleOpen}
            onBlur={scheduleClose}
            onTouchStart={() => {
                longPressed.current = false;
                clear(pressTimer);
                pressTimer.current = setTimeout(() => {
                    longPressed.current = true;
                    setOpen(true);
                }, LONG_PRESS_MS);
            }}
            onTouchEnd={() => clear(pressTimer)}
            onTouchMove={() => clear(pressTimer)}
            onTouchCancel={() => clear(pressTimer)}
            style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
            onContextMenu={(e) => {
                if (longPressed.current) e.preventDefault(); // no native link menu after a long-press
            }}
            onClickCapture={(e) => {
                if (longPressed.current) {
                    longPressed.current = false;
                    e.preventDefault();
                    e.stopPropagation();
                }
            }}
            aria-describedby={open ? cardId : undefined}
        >
            {children}
            {open && <CardPopover id={cardId} memberId={memberId} anchorRef={rootRef} cardRef={cardRef} onClose={() => setOpen(false)} />}
        </span>
    );
}

function CardPopover({
    id,
    memberId,
    anchorRef,
    cardRef,
    onClose,
}: {
    id: string;
    memberId: string;
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    cardRef: React.RefObject<HTMLSpanElement | null>;
    onClose: () => void;
}) {
    const t = useTranslations("memberCard");
    // Rendered in a portal on document.body with fixed coordinates so no ancestor stacking context
    // or overflow clip (e.g. a later section on the live call page) can cover or cut it off.
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [state, setState] = useState<CardState>(() => {
        const hit = cache.get(memberId);
        return hit ? { status: "ok", card: hit } : { status: "loading" };
    });

    useLayoutEffect(() => {
        const place = () => {
            const anchor = anchorRef.current;
            const card = cardRef.current;
            if (!anchor || !card) return;
            const a = anchor.getBoundingClientRect();
            const w = card.offsetWidth;
            const h = card.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            // Trigger scrolled fully out of view: close rather than pin the card to an edge.
            if (a.bottom <= 0 || a.top >= vh || a.right <= 0 || a.left >= vw) {
                onClose();
                return;
            }
            let top = a.bottom + CARD_GAP;
            // Flip above when it does not fit below and there is room above.
            if (top + h > vh - VIEWPORT_MARGIN && a.top - CARD_GAP - h >= VIEWPORT_MARGIN) top = a.top - CARD_GAP - h;
            top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - VIEWPORT_MARGIN - h));
            const left = Math.max(VIEWPORT_MARGIN, Math.min(a.left, vw - VIEWPORT_MARGIN - w));
            setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
        };
        place();
        // Re-place when the card's own size changes (loading -> loaded) and on scroll / resize.
        const ro = typeof ResizeObserver !== "undefined" && cardRef.current ? new ResizeObserver(place) : null;
        if (ro && cardRef.current) ro.observe(cardRef.current);
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        return () => {
            ro?.disconnect();
            window.removeEventListener("scroll", place, true);
            window.removeEventListener("resize", place);
        };
    }, [anchorRef, cardRef, onClose]);

    useEffect(() => {
        let alive = true;
        loadCard(memberId).then((card) => {
            if (alive) setState(card ? { status: "ok", card } : { status: "error" });
        });
        return () => {
            alive = false;
        };
    }, [memberId]);

    return createPortal(
        <span
            ref={cardRef}
            id={id}
            role="dialog"
            aria-label={t("viewProfile")}
            className="paper-soft fixed block w-64 max-w-[80vw] rounded-[16px] border p-3 text-left text-sm font-normal normal-case shadow-lg"
            style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
                zIndex: CARD_Z_INDEX,
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
            }}
        >
            {state.status === "loading" && <span className="block text-foreground/60">{t("loading")}</span>}
            {state.status === "error" && <span className="block text-foreground/60">{t("unavailable")}</span>}
            {state.status === "ok" && <CardBody card={state.card} />}
        </span>,
        document.body,
    );
}

function CardBody({ card }: { card: MemberCard }) {
    const t = useTranslations("memberCard");
    const tSince = useTranslations("memberSince");
    const locale = useLocale();
    const sinceText = formatMemberSince(card.memberSince, locale);
    const meta: string[] = [];
    if (card.levelCompleted != null) meta.push(t("level", { level: String(card.levelCompleted) }));
    if (card.mafiaRank) meta.push(card.mafiaRank);
    return (
        <span className="grid gap-2">
            <span className="flex items-center gap-3">
                {card.pfpUrl ? (
                    <Image src={card.pfpUrl} alt="" width={44} height={44} unoptimized={!isOptimizableImage(card.pfpUrl)} className="h-11 w-11 shrink-0 rounded-full object-cover" />
                ) : (
                    <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground/10 font-bold">
                        {Array.from(card.name)[0]?.toUpperCase() ?? "?"}
                    </span>
                )}
                <span className="min-w-0">
                    <span className="block truncate font-semibold">{card.name}</span>
                    {meta.length > 0 && <span className="block truncate text-xs text-foreground/65">{meta.join(" · ")}</span>}
                </span>
            </span>
            {sinceText && (
                <span data-testid="member-card-since" className="block text-xs text-foreground/65">
                    {tSince("label", { date: sinceText })}
                </span>
            )}
            <DiscordActivityLine activity={card.discordActivity} />
            {card.crews.length > 0 && (
                <span className="flex flex-wrap gap-1" aria-label={t("crews")}>
                    {card.crews.slice(0, 4).map((c) => (
                        <span key={c.id} className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs">
                            {c.emoji ? `${c.emoji} ` : ""}
                            {c.label}
                        </span>
                    ))}
                    {card.crews.length > 4 && <span className="px-1 text-xs text-foreground/60">+{card.crews.length - 4}</span>}
                </span>
            )}
            <Link href={`/profile/${encodeURIComponent(card.memberId)}`} className="text-xs font-semibold text-tomato-readable underline underline-offset-2">
                {t("viewProfile")}
            </Link>
        </span>
    );
}
