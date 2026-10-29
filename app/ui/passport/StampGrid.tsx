"use client";

import { InkStamp } from "./InkStamp";

export interface StampItem {
    /** Stable key: the pizzeria slug. */
    slug: string;
    name: string;
    city: string | null;
    ink: string | null;
    logoUrl: string | null;
    verified: boolean;
    /** "2026-10" */
    month: string;
}

/** A passport page: stamps on paper. */
export function StampGrid({ stamps, size = 130 }: { stamps: StampItem[]; size?: number }) {
    return (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 list-none p-0 m-0">
            {stamps.map((s) => (
                <li key={s.slug} className="flex items-center justify-center rounded-[16px] py-3" style={{ background: "hsl(var(--ink) / 0.03)" }}>
                    <InkStamp
                        seed={s.slug}
                        name={s.name}
                        city={s.city}
                        month={s.month}
                        ink={s.ink}
                        logoUrl={s.logoUrl}
                        verified={s.verified}
                        size={size}
                    />
                </li>
            ))}
        </ul>
    );
}
