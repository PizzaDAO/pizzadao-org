// app/me/wallets/page.tsx
//
// Owner-only wallet management. Absorbs the WalletManager surface that used
// to live in the dashboard's "Collections" collapsible.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §4 / §7 — PR5 (slice-61816).
//
// Server component: resolves the viewer's memberId via session. Renders the
// existing <WalletManager/> client component. There's no public/owner split —
// this route is *only* for the owner managing their own wallets.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { WalletsClient } from "./WalletsClient";

export const runtime = "nodejs";

export const metadata: Metadata = {
    title: "Wallets · PizzaDAO",
    description: "Manage your linked wallets",
    robots: { index: false, follow: false },
};

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";
const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
                <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
                    {reason}
                </p>
                <Link
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
                </Link>
            </div>
        </div>
    );
}

export default async function MyWalletsPage({
    searchParams,
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    // searchParams supports ?memberId= override for QA, but we still verify
    // it matches the viewer's resolved memberId — never trust client input.
    const sp: Record<string, string | string[] | undefined> =
        (await (searchParams ?? Promise.resolve({}))) || {};
    const queryMemberId =
        typeof sp.memberId === "string" ? sp.memberId : null;

    const session = await getSession();
    if (!session?.discordId) {
        return <Forbidden reason="Please log in to manage your wallets." />;
    }

    let viewerMemberId: string | null = null;
    try {
        viewerMemberId = await fetchMemberIdByDiscordId(session.discordId);
    } catch {
        viewerMemberId = null;
    }

    if (!viewerMemberId) {
        return (
            <Forbidden reason="We couldn't link your session to a member ID. Try logging out and back in." />
        );
    }

    if (queryMemberId && queryMemberId !== viewerMemberId) {
        return (
            <Forbidden reason="You can only manage your own wallets." />
        );
    }

    return <WalletsClient memberId={viewerMemberId} />;
}
