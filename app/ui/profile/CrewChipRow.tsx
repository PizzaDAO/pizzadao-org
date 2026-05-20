"use client";

// app/ui/profile/CrewChipRow.tsx
//
// Display-only crew chip row for /profile/[id]. Plan: truffle-91035 (PR2 —
// pepperoni-77692). Replaces the existing crew cards which surfaced
// "Claimed Tasks" to strangers (privacy-soft leak per plan §1.4) and per-
// crew closed counts (operational owner data per plan §4 cut list).
// Display-only: emoji + label, link to /crew/[id].

import Link from "next/link";

export type CrewOption = {
    id: string;
    label: string;
    emoji?: string;
};

interface CrewChipRowProps {
    crewIds: string[];
    crewOptions: CrewOption[];
}

export function CrewChipRow({ crewIds, crewOptions }: CrewChipRowProps) {
    if (!crewIds || crewIds.length === 0) return null;

    return (
        <section
            className="rounded-[--radius] border border-rule p-5 sm:p-6 shadow-sm"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
            }}
        >
            <h3 className="mt-0 mb-3 font-display text-lg font-semibold text-foreground">
                Crews
            </h3>
            <div className="flex flex-wrap gap-2">
                {crewIds.map((crewName) => {
                    const c = crewOptions.find(
                        (opt) =>
                            opt.label.toLowerCase() === crewName.toLowerCase() ||
                            opt.id.toLowerCase() === crewName.toLowerCase(),
                    );
                    const label = c?.label || crewName;
                    const emoji = c?.emoji || "🍕";
                    const crewId = (
                        c?.id || crewName.toLowerCase().replace(/\s+/g, "_")
                    ).toLowerCase();
                    return (
                        <Link
                            key={crewName}
                            href={`/crew/${crewId}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rule text-foreground no-underline text-sm font-medium transition-colors hover:border-tomato hover:text-tomato"
                            style={{ background: "hsl(var(--background))" }}
                        >
                            <span aria-hidden>{emoji}</span>
                            <span>{label}</span>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
