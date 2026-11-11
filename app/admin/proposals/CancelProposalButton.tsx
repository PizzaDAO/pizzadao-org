"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Cancel one proposal: asks for a reason (required, kept in the log), then calls the DPR-only route. */
export function CancelProposalButton({ proposalId }: { proposalId: string }) {
    const router = useRouter();
    const [asking, setAsking] = useState(false);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function cancel() {
        setBusy(true);
        setError("");
        try {
            const r = await fetch(`/api/admin/proposals/${encodeURIComponent(proposalId)}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            if (r.ok) {
                router.refresh();
                return;
            }
            const b = await r.json().catch(() => ({}));
            setError(b.error === "bad_reason" ? "Give a reason (at least 3 characters)." : b.error === "not_cancellable" ? "It is no longer waiting or open." : "Could not cancel.");
        } catch {
            setError("Could not cancel.");
        } finally {
            setBusy(false);
        }
    }

    if (!asking) {
        return (
            <button type="button" className="min-h-10 rounded border px-3" onClick={() => setAsking(true)}>
                Cancel
            </button>
        );
    }
    return (
        <div className="grid gap-2">
            <label className="grid gap-1 text-sm">
                Reason
                <input className="min-h-10 w-56 rounded border bg-card px-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </label>
            <div className="flex gap-2">
                <button type="button" disabled={busy || reason.trim().length < 3} className="min-h-10 rounded bg-foreground px-3 text-background disabled:opacity-50" onClick={cancel}>
                    {busy ? "Cancelling..." : "Cancel proposal"}
                </button>
                <button type="button" disabled={busy} className="min-h-10 rounded border px-3" onClick={() => setAsking(false)}>
                    Keep
                </button>
            </div>
            {error && (
                <p role="alert" className="m-0 text-sm text-tomato">
                    {error}
                </p>
            )}
        </div>
    );
}
