// app/ui/economy/SendPepModal.tsx
//
// capricciosa-35929 — Editorial restyle. Paper-soft modal surface, overline
// section label, btn-pill-lg accent CTA. API contract unchanged — still
// POSTs /api/economy/transfer with { toUserId, amount } and invalidates the
// 'my-balance' React Query key on success.
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { PepIcon } from "./PepIcon";

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
        minHeight: 44,
        padding: "10px 12px",
        borderRadius: 10,
        border: '1px solid hsl(var(--rule-warm) / 0.55)',
        fontSize: 16,
        outline: "none",
        boxSizing: "border-box" as const,
        background: "hsl(var(--cream))",
        color: "hsl(var(--foreground))",
    };

    const disabled = loading || !memberId || !amount;

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'hsl(var(--ink) / 0.55)',
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                zIndex: 1000,
            }}
            onClick={onClose}
        >
            <div
                className="paper-soft fade-up relative overflow-hidden rounded-[24px] border"
                style={{
                    maxWidth: 420,
                    width: "100%",
                    background: "hsl(var(--card))",
                    borderColor: "hsl(var(--rule-warm) / 0.55)",
                    boxShadow: "var(--shadow-lifted)",
                    padding: 24,
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="relative flex items-start justify-between gap-4">
                    <p className="overline text-tomato">§ ··· Send</p>
                    <span
                        className="handwritten -rotate-[6deg]"
                        style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}
                    >
                        on the books
                    </span>
                </div>

                <h2
                    className="font-[family-name:var(--font-display)] relative mt-2 flex items-center gap-2 font-black tracking-[-0.02em] text-foreground"
                    style={{
                        fontSize: "clamp(1.6rem, 4vw, 2rem)",
                        lineHeight: 0.95,
                    }}
                >
                    Move <PepIcon size={26} />
                </h2>

                {error && (
                    <div
                        className="relative mt-4"
                        style={{
                            padding: 12,
                            background: "hsl(var(--tomato) / 0.08)",
                            border: "1px solid hsl(var(--tomato) / 0.30)",
                            borderRadius: "var(--radius)",
                            color: "hsl(var(--tomato-deep))",
                            fontSize: 14,
                        }}
                    >
                        {error}
                    </div>
                )}

                <form onSubmit={handleSend} className="relative mt-5 grid gap-4">
                    <div>
                        <label className="overline mb-2 block text-foreground/55">
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

                    <div className="rule-warm" />

                    <div>
                        <label className="overline mb-2 block text-foreground/55">
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

                    <div className="mt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-pill flex-1"
                            style={{
                                background: "hsl(var(--secondary))",
                                color: "hsl(var(--secondary-foreground))",
                                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={disabled}
                            className="btn-pill-lg group flex-1"
                            style={{
                                background: "hsl(var(--tomato))",
                                color: "hsl(var(--cream))",
                                border: "1px solid hsl(var(--tomato))",
                                boxShadow: disabled ? "none" : "var(--shadow-soft)",
                            }}
                        >
                            {loading ? "Sending..." : (
                                <>
                                    Send
                                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
