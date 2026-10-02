// app/dashboard/[id]/components/ProfileCompletionMeter.tsx
//
// jalapeno-34126 — Compact "N of M" profile-setup meter for the dashboard
// hero. Editorial vocabulary: a thin tomato progress ring, overline label,
// display-font count, and a ruled link to the next incomplete step. Renders
// nothing once the profile is complete (the one-time celebration takes over).
"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ProfileCompletion } from "../lib/profile-completion";

const RING_SIZE = 44;
const STROKE = 4;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const NEXT_LINK_CLASS =
    "ui inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-tomato transition-colors hover:text-foreground";
const NEXT_LINK_STYLE = { textDecoration: "none", minHeight: 44 } as const;

export function ProfileCompletionMeter({ completion }: { completion: ProfileCompletion | null | undefined }) {
    if (!completion || completion.isComplete || completion.total === 0) return null;

    const { completed, total, percent, next, steps } = completion;
    const dashOffset = CIRCUMFERENCE * (1 - percent / 100);
    const remaining = steps.filter((s) => !s.done).map((s) => s.label).join(", ");

    return (
        <div
            data-testid="profile-completion-meter"
            className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border px-4 py-3"
            style={{
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                background: "hsl(var(--cream) / 0.55)",
            }}
        >
            <div
                role="progressbar"
                aria-label="Profile setup"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={completed}
                aria-valuetext={`${completed} of ${total} steps complete`}
                className="relative shrink-0"
                style={{ width: RING_SIZE, height: RING_SIZE }}
            >
                <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
                    <circle
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="hsl(var(--foreground) / 0.12)"
                        strokeWidth={STROKE}
                    />
                    <circle
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="hsl(var(--tomato))"
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                        strokeDasharray={CIRCUMFERENCE}
                        strokeDashoffset={dashOffset}
                        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                        className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
                    />
                </svg>
                <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center font-[family-name:var(--font-display)] text-[13px] font-black tabular-nums text-foreground"
                >
                    {completed}/{total}
                </span>
            </div>

            <div className="min-w-0 flex-1">
                <p className="overline m-0 text-tomato">§ profile setup</p>
                <p
                    className="m-0 font-[family-name:var(--font-display)] font-bold tracking-[-0.01em] text-foreground"
                    style={{ fontSize: 16, lineHeight: 1.2 }}
                >
                    {completed} of {total} done
                    <span className="sr-only"> — remaining: {remaining}</span>
                </p>
            </div>

            {next &&
                // /api/* hrefs (e.g. the X OAuth start) are full-page redirects,
                // not app routes — use a plain anchor so the router doesn't
                // try to prefetch/soft-navigate them.
                (next.href.startsWith("/api/") ? (
                    <a href={next.href} className={NEXT_LINK_CLASS} style={NEXT_LINK_STYLE}>
                        Next: {next.label}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                ) : (
                    <Link href={next.href} className={NEXT_LINK_CLASS} style={NEXT_LINK_STYLE}>
                        Next: {next.label}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                ))}
        </div>
    );
}
