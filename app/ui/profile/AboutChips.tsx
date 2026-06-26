"use client";

// app/ui/profile/AboutChips.tsx
//
// Profile About block — Plan: truffle-91035 (PR2 — pepperoni-77692).
// Replaces the 2-col stat grid (status/ID/orgs/skills/X/roles) with chip
// rows. Status and "Other Roles" comma-list are dropped per plan §4 cut
// list. ID was visitor-meaningless. Turtle imagery is preserved.
// Profile links live in their own component (ProfileLinksDisplay) — passed
// in via memberId because that component owns its own fetch.
//
// onion-47612: editorial restyle — paper-soft card, "§ 02 · About" overline,
// chip group labels move to .overline, ink-toned chips. Logic unchanged.

import Link from "next/link";
import { TURTLES } from "../constants";
import { ProfileLinksDisplay } from "../profile-links";

interface AboutChipsProps {
    memberId: string;
    skills?: string;
    orgs?: string;
    turtles?: string[];
    xAccount?: { connected?: boolean; username?: string } | null;
}

function splitList(s?: string): string[] {
    if (!s) return [];
    return s
        .split(/[,;|]+/)
        .map((x) => x.trim())
        .filter(Boolean);
}

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-foreground transition-colors"
            style={{
                background: "hsl(var(--cream) / 0.6)",
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
            }}
        >
            {children}
        </span>
    );
}

function ChipRow({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <h3 className="overline m-0 mb-2 text-foreground/55">
                {label}
            </h3>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}

const CARD_CLASS = "paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6";
const CARD_STYLE: React.CSSProperties = {
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    borderColor: "hsl(var(--rule-warm) / 0.55)",
    boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
};

export function AboutChips({
    memberId,
    skills,
    orgs,
    turtles,
    xAccount,
}: AboutChipsProps) {
    const skillList = splitList(skills);
    const orgList = splitList(orgs);
    const turtleList = (turtles ?? []).filter(Boolean);

    // If everything is empty, render nothing.
    const hasContent =
        skillList.length > 0 ||
        orgList.length > 0 ||
        turtleList.length > 0 ||
        !!xAccount?.connected;
    if (!hasContent) {
        // Still render link display, which has its own loading + empty handling.
        return (
            <section className={CARD_CLASS} style={CARD_STYLE}>
                <p className="overline text-tomato mb-3">§ 02 · About</p>
                <ProfileLinksDisplay memberId={memberId} variant="inline" />
            </section>
        );
    }

    return (
        <section className={`${CARD_CLASS} grid gap-5`} style={CARD_STYLE}>
            <p className="overline text-tomato">§ 02 · About</p>

            {skillList.length > 0 && (
                <ChipRow label="Skills">
                    {skillList.map((s) => (
                        <Chip key={s}>{s}</Chip>
                    ))}
                </ChipRow>
            )}

            {orgList.length > 0 && (
                <ChipRow label="Orgs">
                    {orgList.map((s) => (
                        <Chip key={s}>{s}</Chip>
                    ))}
                </ChipRow>
            )}

            {turtleList.length > 0 && (
                <div>
                    <h3 className="overline m-0 mb-2 text-foreground/55">
                        Roles
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                        {turtleList.map((tName) => {
                            const tDef = TURTLES.find(
                                (t) =>
                                    t.id.toLowerCase() === tName.toLowerCase() ||
                                    t.label.toLowerCase() === tName.toLowerCase(),
                            );
                            if (!tDef) return null;
                            return (
                                <Link
                                    key={tDef.id}
                                    href={`/turtles/${encodeURIComponent(tDef.id)}`}
                                    title={`View all ${tDef.label} members`}
                                    className="hover:opacity-80 transition-opacity"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={tDef.image}
                                        alt={tDef.label}
                                        style={{ width: 40, height: 40, objectFit: "contain" }}
                                    />
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* X handle merged into links per plan §4 */}
            <div>
                <ProfileLinksDisplay memberId={memberId} variant="inline" />
                {xAccount?.connected && xAccount.username && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a
                            href={`https://x.com/${xAccount.username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-foreground no-underline text-sm font-medium transition-colors hover:border-tomato hover:text-tomato"
                            style={{
                                background: "hsl(var(--cream) / 0.6)",
                                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                            }}
                        >
                            <span aria-hidden>𝕏</span>
                            <span>@{xAccount.username}</span>
                        </a>
                    </div>
                )}
            </div>
        </section>
    );
}
