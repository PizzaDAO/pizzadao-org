// app/ui/economy/SendPepModal.tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PepIcon } from "./PepIcon";

// Tokens: see app/globals.css. Body uses --font-sans (Asap), headings use
// --font-display (Asap Condensed). Colors via hsl(var(--<token>)).
const FONT_DISPLAY = "var(--font-display), var(--font-sans), system-ui, sans-serif";

// Local style helpers — kept identical to the dashboard's local helpers so the
// modal renders pixel-for-pixel the same as before the extraction.
function card(): React.CSSProperties {
    return {
        border: '1px solid hsl(var(--rule) / 0.12)',
        borderRadius: "var(--radius)",
        padding: 24,
        boxShadow: '0 8px 30px hsl(var(--ink) / 0.06)',
        background: 'hsl(var(--card))',
        color: 'hsl(var(--card-foreground))',
        display: "grid",
        gap: 14,
    };
}

function btn(kind: "primary" | "secondary" | "accent"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // sicilian-41551: 44px mobile touch-target floor.
        minHeight: 44,
        padding: "10px 16px",
        borderRadius: "var(--radius)",
        border: '1px solid transparent',
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    };
    if (kind === "primary") {
        return {
            ...base,
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            borderColor: 'hsl(var(--primary))',
        };
    }
    if (kind === "accent") {
        return {
            ...base,
            background: 'hsl(var(--tomato))',
            color: 'hsl(var(--cream))',
            borderColor: 'hsl(var(--tomato))',
        };
    }
    return {
        ...base,
        background: 'hsl(var(--secondary))',
        color: 'hsl(var(--secondary-foreground))',
        borderColor: 'hsl(var(--rule) / 0.22)',
    };
}

export type SendPepModalProps = {
    open: boolean;
    onClose: () => void;
    /** Caller's member id — reserved for future use (e.g. self-prevention). Not currently used. */
    currentMemberId?: string;
};

export function SendPepModal({ open, onClose, currentMemberId: _currentMemberId }: SendPepModalProps) {
    const queryClient = useQueryClient();
    const [memberId, setMemberId] = useState("");
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!memberId || !amount) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/economy/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toUserId: memberId, amount: Number(amount) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            // Refresh balance via React Query (matches previous dashboard behavior)
            queryClient.invalidateQueries({ queryKey: ['my-balance'] });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to send");
        } finally {
            setLoading(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: "100%",
        // sicilian-41551: 44px min-height + 16px font to clear the iOS Safari
        // zoom-on-focus threshold.
        minHeight: 44,
        padding: "10px 12px",
        borderRadius: 10,
        border: '1px solid hsl(var(--rule) / 0.22)',
        fontSize: 16,
        outline: "none",
        boxSizing: "border-box" as const,
    };

    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'hsl(var(--ink) / 0.5)',
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // sicilian-41551: gutter so the modal never goes edge-to-edge.
            padding: 16,
            zIndex: 1000,
        }} onClick={onClose}>
            <div style={{ ...card(), maxWidth: 400, width: "100%" }} onClick={e => e.stopPropagation()}>
                <h2 style={{ fontSize: 22, fontWeight: 800, fontFamily: FONT_DISPLAY, letterSpacing: "-0.01em", marginTop: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                    Send <PepIcon size={20} />
                </h2>

                {error && (
                    <div style={{ marginBottom: 16, padding: 12, background: "hsl(var(--tomato) / 0.08)", border: "1px solid hsl(var(--tomato) / 0.30)", borderRadius: "var(--radius)", color: "hsl(var(--tomato-deep))", fontSize: 14 }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSend} style={{ display: "grid", gap: 16 }}>
                    <div>
                        <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
                            Recipient Member ID
                        </label>
                        <input
                            type="text"
                            placeholder="Enter member ID"
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            style={inputStyle}
                            disabled={loading}
                        />
                    </div>

                    <div>
                        <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
                            Amount
                        </label>
                        <input
                            type="number"
                            placeholder="Amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            style={inputStyle}
                            disabled={loading}
                            min="1"
                        />
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button type="button" onClick={onClose} style={{ ...btn("secondary"), flex: 1, fontFamily: "inherit" }}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !memberId || !amount}
                            style={{ ...btn("primary"), flex: 1, fontFamily: "inherit", opacity: loading || !memberId || !amount ? 0.5 : 1 }}
                        >
                            {loading ? "Sending..." : "Send"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
