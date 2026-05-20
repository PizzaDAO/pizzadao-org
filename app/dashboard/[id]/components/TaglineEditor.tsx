"use client";

// app/dashboard/[id]/components/TaglineEditor.tsx
//
// Inline editor for the member's free-form tagline (one-liner). Mirrors the
// orgs / skills inline-edit pattern in app/dashboard/[id]/page.tsx — pencil
// icon → textarea + character counter → Save/Cancel.
//
// Persists via POST /api/profile-extras/[id] (owner-only). Optimistically
// patches the profile-summary cache so the public hero updates on next
// render without waiting for a fresh fetch.
//
// Plan: truffle-91035 (PR4 — burrata-13316).

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useProfileExtras, useUpdateTagline } from "../../../lib/hooks/use-api";

const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

export const TAGLINE_MAX_LEN = 140;

interface TaglineEditorProps {
    memberId: string;
    /** Initial value to seed from (e.g. sheet fallback while DB row is loading). */
    initialTagline?: string;
}

export function TaglineEditor({ memberId, initialTagline }: TaglineEditorProps) {
    const { data, isLoading } = useProfileExtras(memberId);
    const update = useUpdateTagline(memberId);

    const dbValue = data?.tagline ?? "";
    const displayValue = dbValue || initialTagline || "";

    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Reset local input when the underlying data changes (e.g. after save).
    useEffect(() => {
        if (!editing) setInput(displayValue);
    }, [displayValue, editing]);

    function startEdit() {
        setInput(displayValue);
        setError(null);
        setEditing(true);
    }

    async function save() {
        const next = input.trim();
        if (next.length > TAGLINE_MAX_LEN) {
            setError(`Max ${TAGLINE_MAX_LEN} characters.`);
            return;
        }
        setError(null);
        try {
            await update.mutateAsync(next);
            setEditing(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save");
        }
    }

    function cancel() {
        setInput(displayValue);
        setError(null);
        setEditing(false);
    }

    const remaining = TAGLINE_MAX_LEN - input.length;
    const overLimit = remaining < 0;

    return (
        <div style={{ gridColumn: "1 / -1" }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                }}
            >
                <h3
                    style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "hsl(var(--muted-foreground))",
                        margin: 0,
                        fontWeight: 700,
                        fontFamily: FONT_DISPLAY,
                    }}
                >
                    Tagline
                </h3>
                {!editing && (
                    <button
                        type="button"
                        onClick={startEdit}
                        style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            opacity: 0.4,
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                        }}
                        title="Edit tagline"
                        aria-label="Edit tagline"
                    >
                        <Pencil size={12} />
                    </button>
                )}
            </div>

            {editing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        maxLength={TAGLINE_MAX_LEN + 50 /* allow over for UX, server validates */}
                        placeholder="A one-line bio for your public profile"
                        rows={2}
                        style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid hsl(var(--rule) / 0.22)",
                            fontSize: 14,
                            fontFamily: "inherit",
                            resize: "vertical",
                            minHeight: 60,
                        }}
                    />
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                        }}
                    >
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                type="button"
                                onClick={save}
                                disabled={update.isPending || overLimit}
                                style={{
                                    background: "hsl(var(--tomato))",
                                    color: "hsl(var(--cream))",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "6px 12px",
                                    fontSize: 12,
                                    fontWeight: 700,
                                    fontFamily: FONT_DISPLAY,
                                    cursor: overLimit ? "not-allowed" : "pointer",
                                    opacity: overLimit ? 0.5 : 1,
                                }}
                            >
                                {update.isPending ? "Saving..." : "Save"}
                            </button>
                            <button
                                type="button"
                                onClick={cancel}
                                style={{
                                    background: "transparent",
                                    color: "hsl(var(--foreground))",
                                    border: "1px solid hsl(var(--rule) / 0.22)",
                                    borderRadius: 6,
                                    padding: "6px 12px",
                                    fontSize: 12,
                                    fontFamily: FONT_DISPLAY,
                                    cursor: "pointer",
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                        <span
                            style={{
                                fontSize: 11,
                                color: overLimit
                                    ? "hsl(var(--tomato))"
                                    : "hsl(var(--muted-foreground))",
                                fontVariantNumeric: "tabular-nums",
                            }}
                            aria-live="polite"
                        >
                            {remaining} characters left
                        </span>
                    </div>
                    {error && (
                        <p
                            style={{
                                fontSize: 12,
                                color: "hsl(var(--tomato))",
                                margin: 0,
                            }}
                            role="alert"
                        >
                            {error}
                        </p>
                    )}
                </div>
            ) : (
                <p
                    style={{
                        fontSize: 18,
                        fontWeight: 500,
                        color: "hsl(var(--foreground))",
                        margin: 0,
                        wordBreak: "break-word",
                        opacity: displayValue ? 1 : 0.5,
                        fontStyle: displayValue ? "normal" : "italic",
                    }}
                >
                    {displayValue
                        ? displayValue
                        : isLoading
                            ? "…"
                            : "Add a tagline to your public profile"}
                </p>
            )}
        </div>
    );
}
