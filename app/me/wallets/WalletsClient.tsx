// app/me/wallets/WalletsClient.tsx
//
// Thin client wrapper for /me/wallets. The parent server component already
// verified that the viewer owns this memberId, so we just render the existing
// <WalletManager/>.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §4 / §7 — PR5 (slice-61816).
"use client";

import Link from "next/link";
import { WalletManager } from "../../ui/wallet-manager/WalletManager";

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";
const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

function card(): React.CSSProperties {
    return {
        border: "1px solid hsl(var(--rule) / 0.12)",
        borderRadius: "var(--radius)",
        padding: 24,
        boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 14,
    };
}

export function WalletsClient({ memberId }: { memberId: string }) {
    return (
        <div
            style={{
                minHeight: "100vh",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontFamily: FONT_SANS,
                padding: "40px 20px",
            }}
        >
            <div
                style={{
                    maxWidth: 800,
                    margin: "0 auto",
                    display: "grid",
                    gap: 20,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <Link
                            href={`/dashboard/${memberId}`}
                            style={{
                                fontSize: 14,
                                color: "hsl(var(--muted-foreground))",
                                textDecoration: "none",
                            }}
                        >
                            ← Back to dashboard
                        </Link>
                        <h1
                            style={{
                                margin: "4px 0 0",
                                fontSize: 32,
                                fontFamily: FONT_DISPLAY,
                                fontWeight: 800,
                                letterSpacing: "-0.01em",
                            }}
                        >
                            Wallets
                        </h1>
                        <p
                            style={{
                                margin: "6px 0 0",
                                fontSize: 14,
                                color: "hsl(var(--muted-foreground))",
                            }}
                        >
                            Link wallets to collect POAPs, NFTs, and prove on-chain identity.
                        </p>
                    </div>
                </div>

                <section style={card()}>
                    <WalletManager memberId={memberId} />
                </section>
            </div>
        </div>
    );
}
