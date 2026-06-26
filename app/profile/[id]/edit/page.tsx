// app/profile/[id]/edit/page.tsx
//
// Owner-only identity/connections editor. This route absorbs the editing
// surfaces that previously lived inside the dashboard's "Profile Details"
// collapsible (orgs, skills, X account, profile links, social accounts).
//
// Plan: plans/garlic-96648-dashboard-redesign.md §7 — PR5 (slice-61816).
//
// onion-47612: editorial restyle. The 403 forbidden state now mirrors
// the public profile's error treatment — paper-soft + overline + btn-pill.
//
// Server component pattern (mirrors app/profile/[id]/page.tsx):
//   - Verify ownership server-side. Non-owners get 403, never see the form.
//   - Render <EditClient/> for interactivity.
//   - Page-level metadata is private (noindex) since edit surfaces are
//     owner-only.

import type { Metadata } from "next";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { EditClient } from "./EditClient";

export const runtime = "nodejs";

export const metadata: Metadata = {
    title: "Edit profile · PizzaDAO",
    description: "Edit your PizzaDAO profile",
    robots: { index: false, follow: false },
};

async function resolveViewerMemberId(): Promise<{ discordId: string | null; viewerMemberId: string | null }> {
    const session = await getSession();
    if (!session?.discordId) return { discordId: null, viewerMemberId: null };
    try {
        const id = await fetchMemberIdByDiscordId(session.discordId);
        return { discordId: session.discordId, viewerMemberId: id ?? null };
    } catch {
        return { discordId: session.discordId, viewerMemberId: null };
    }
}

function Forbidden({ reason }: { reason: string }) {
    return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
            <div
                className="paper-soft halftone-soft relative grid gap-4 rounded-[28px] border p-7 max-w-md w-full fade-up"
                style={{
                    background: "hsl(var(--card))",
                    color: "hsl(var(--card-foreground))",
                    borderColor: "hsl(var(--rule-warm) / 0.55)",
                    boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
                }}
            >
                <p className="overline text-tomato">§ 403 · Off the record</p>
                <h1
                    className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground m-0"
                    style={{
                        fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                        lineHeight: 1.0,
                    }}
                >
                    Forbidden
                </h1>
                <p className="m-0 text-foreground/70">{reason}</p>
                <a
                    href="/"
                    className="btn-pill self-start"
                    style={{
                        background: "hsl(var(--ink))",
                        color: "hsl(var(--cream))",
                    }}
                >
                    Back to home
                </a>
            </div>
        </div>
    );
}

export default async function EditProfilePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const { discordId, viewerMemberId } = await resolveViewerMemberId();

    if (!discordId) {
        return <Forbidden reason="Please log in to edit your profile." />;
    }
    if (!viewerMemberId || viewerMemberId !== id) {
        return (
            <Forbidden reason="You can only edit your own profile." />
        );
    }

    return <EditClient memberId={id} />;
}
