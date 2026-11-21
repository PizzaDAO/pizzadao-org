// app/dashboard/[id]/components/MemeFolderCard.tsx
//
// Meme folder card (bellpepper-80127). Reads /api/memes?limit=4&meta=1, which answers { enabled: false }
// while the setting memes.enabled is off, so with the setting off this renders nothing.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface CardItem {
    id: string;
    url: string | null;
    caption: string | null;
}
interface CardState {
    enabled: boolean;
    items?: CardItem[];
    meta?: { canUpload: boolean; reviewer: boolean; pending: number | null };
}

export function MemeFolderCard({ initial }: { initial?: CardState | null }) {
    const t = useTranslations("memes");
    const [state, setState] = useState<CardState | null>(initial ?? null);

    useEffect(() => {
        if (initial) return;
        let live = true;
        fetch("/api/memes?limit=4&meta=1", { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<CardState>) : null))
            .then((s) => live && setState(s))
            .catch(() => {
                /* the card simply stays hidden */
            });
        return () => {
            live = false;
        };
    }, [initial]);

    if (!state?.enabled) return null;
    const items = (state.items ?? []).filter((m) => m.url);
    const waiting = state.meta?.reviewer ? (state.meta.pending ?? 0) : 0;

    return (
        <section id="memes" data-testid="meme-folder-card" className="my-5 scroll-mt-24 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5" aria-label={t("cardTitle")}>
            <p className="overline">{t("cardTitle")}</p>
            {items.length === 0 ? (
                <p className="my-3 text-foreground/80">{t("cardEmpty")}</p>
            ) : (
                <ul className="my-3 grid list-none grid-cols-4 gap-2 p-0">
                    {items.map((m) => (
                        <li key={m.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.url ?? ""} alt={m.caption ?? ""} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
                        </li>
                    ))}
                </ul>
            )}
            {waiting > 0 && (
                <p className="my-2 text-sm font-semibold">
                    <Link href="/memes/review" className="underline">
                        {t("cardWaiting", { count: waiting })}
                    </Link>
                </p>
            )}
            <div className="flex flex-wrap gap-3">
                <Link href="/memes" className="btn-pill min-h-11 border border-foreground/20">
                    {t("openFolder")}
                </Link>
            </div>
        </section>
    );
}
