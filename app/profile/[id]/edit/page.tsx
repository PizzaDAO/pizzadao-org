// app/profile/[id]/edit/page.tsx
//
// Owner-only identity/connections editor. This route absorbs the editing
// surfaces that previously lived inside the dashboard's "Profile Details"
// collapsible (orgs, skills, X account, profile links, social accounts).
//
// Plan: plans/garlic-96648-dashboard-redesign.md §7 — PR5 (slice-61816).
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

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
                padding: 20,
            }}
        >
            <div
                style={{
                    border: "1px solid hsl(var(--rule) / 0.12)",
                    borderRadius: "var(--radius)",
                    padding: 24,
                    boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
                    background: "hsl(var(--card))",
                    color: "hsl(var(--card-foreground))",
                    display: "grid",
                    gap: 14,
                    maxWidth: 420,
                    width: "100%",
                }}
            >
                <h1
                    style={{
                        fontSize: 28,
                        margin: 0,
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 800,
                        letterSpacing: "-0.01em",
                    }}
                >
                    403 — Forbidden
                </h1>
                <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>{reason}</p>
                <a
                    href="/"
                    style={{
                        display: "inline-block",
                        padding: "10px 16px",
                        borderRadius: "var(--radius)",
                        background: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontFamily: FONT_DISPLAY,
                        textAlign: "center",
                    }}
                >
                    Back to Home
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
