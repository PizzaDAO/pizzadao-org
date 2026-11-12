"use client";

// app/ui/profile/CollectionsLazy.tsx
//
// Collapsible + IntersectionObserver-gated wrapper around the heavy
// collection components (POAPs, NFTs, Unlock tickets). Plan: truffle-91035
// (PR2 — pepperoni-77692). Per plan §4 the collections block is now
// defaultClosed so first paint isn't blocked, and children are only
// mounted once the section opens OR scrolls into view — whichever comes
// first.
//
// onion-47612: editorial restyle — paper-soft card wrapper with
// "§ 06 · Collections" overline above the CollapsibleSection title. The
// CollapsibleSection primitive itself is off-limits, so we layer
// the overline above and leave the title control as-is.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { POAPCollection } from "../poap";
import { NFTCollection } from "../nft";
import { UnlockTicketCard } from "../unlock-ticket-card";
import { CollapsibleSection } from "../shared/CollapsibleSection";

interface CollectionsLazyProps {
    memberId: string;
}

export function CollectionsLazy({ memberId }: CollectionsLazyProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [opened, setOpened] = useState(false);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        if (inView) return; // already triggered
        const el = wrapperRef.current;
        if (!el || typeof IntersectionObserver === "undefined") {
            setInView(true);
            return;
        }
        const obs = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setInView(true);
                        obs.disconnect();
                        break;
                    }
                }
            },
            { rootMargin: "200px" },
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [inView]);

    const shouldMount = opened || inView;

    return (
        <section
            ref={wrapperRef}
            className="paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <p className="overline text-tomato mb-3">§ 06 · Collections</p>
            <CollectionStatsBar memberId={memberId} />
            <ToggleAndMount memberId={memberId} onOpenChange={setOpened} shouldMount={shouldMount} />
        </section>
    );
}

// Internal helper so we can intercept the open-state from CollapsibleSection.
// CollapsibleSection holds its own state; we wire a second observer by
// re-rendering and reading its aria-expanded via a child callback.
function ToggleAndMount({
    memberId,
    onOpenChange,
    shouldMount,
}: {
    memberId: string;
    onOpenChange: (open: boolean) => void;
    shouldMount: boolean;
}) {
    return (
        <CollapsibleSection title="Collections" defaultOpen={false}>
            <OpenSignal onOpen={() => onOpenChange(true)} />
            {shouldMount ? (
                <div className="grid gap-4">
                    <POAPCollection memberId={memberId} />
                    <NFTCollection memberId={memberId} showConnectPrompt={false} />
                    <UnlockTicketCard memberId={memberId} />
                </div>
            ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                    Loading collections…
                </div>
            )}
        </CollapsibleSection>
    );
}

interface Stats {
    poapCount: number;
    nftCount: number;
    nftCollections: number;
    ticketCount: number;
    hasWallet: boolean;
    pending: boolean;
}

/**
 * Counts from the nightly precompute (one cheap read), shown at once while the heavy lists below
 * load lazily. Renders nothing until the numbers are in, while they are still being computed for
 * the first time, or when there is nothing to count.
 */
function CollectionStatsBar({ memberId }: { memberId: string }) {
    const t = useTranslations("collectionStats");
    const [stats, setStats] = useState<Stats | null>(null);

    useEffect(() => {
        let alive = true;
        fetch(`/api/collection-stats/${encodeURIComponent(memberId)}`)
            .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
            .then((j) => {
                if (alive) setStats(j);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [memberId]);

    if (!stats || stats.pending) return null;
    const items = [
        { key: "poaps", n: stats.poapCount, label: t("poaps", { count: stats.poapCount }) },
        { key: "nfts", n: stats.nftCount, label: t("nfts", { count: stats.nftCount, collections: stats.nftCollections }) },
        { key: "tickets", n: stats.ticketCount, label: t("tickets", { count: stats.ticketCount }) },
    ].filter((i) => i.n > 0);
    if (items.length === 0) return null;
    return (
        <ul className="m-0 mb-3 flex list-none flex-wrap gap-2 p-0" aria-label={t("aria")}>
            {items.map((i) => (
                <li key={i.key} className="rounded-full border border-foreground/15 px-3 py-1 text-sm">
                    {i.label}
                </li>
            ))}
        </ul>
    );
}

// CollapsibleSection only renders children when open, so mounting this
// component IS the "open" signal. We fire onOpen() once on mount.
function OpenSignal({ onOpen }: { onOpen: () => void }) {
    useEffect(() => {
        onOpen();
    }, [onOpen]);
    return null;
}
