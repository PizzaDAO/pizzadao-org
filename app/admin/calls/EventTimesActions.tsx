"use client";

// Buttons for the crew call time sync panel. Both go through the reviewer-gated
// /api/admin/calls/event-times route; "dry run" can never change Discord.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Busy = null | "fill" | "dry-run";

export function EventTimesActions() {
    const router = useRouter();
    const [busy, setBusy] = useState<Busy>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function run(action: "fill" | "dry-run") {
        setBusy(action);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/calls/event-times", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (!res.ok || !json) {
                setMessage(`Failed (${res.status})${typeof json?.error === "string" ? `: ${json.error}` : ""}`);
            } else if (action === "fill") {
                setMessage(`Added ${json.added} row(s); ${json.total} in the table.`);
            } else if (typeof json.notRun === "string") {
                setMessage(`Nothing to check: ${json.notRun}.`);
            } else {
                setMessage(
                    `Dry run: checked ${json.checked}, would move ${json.wouldPatch}, left alone ${json.skipped}, failed ${json.failed}. Nothing was changed in Discord.`,
                );
            }
            router.refresh();
        } catch {
            setMessage("Request failed.");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-full border px-4 py-1.5 text-sm font-semibold" disabled={busy !== null} onClick={() => run("fill")}>
                {busy === "fill" ? "Filling..." : "Fill from Discord"}
            </button>
            <button type="button" className="rounded-full border px-4 py-1.5 text-sm font-semibold" disabled={busy !== null} onClick={() => run("dry-run")}>
                {busy === "dry-run" ? "Checking..." : "Run now (dry run)"}
            </button>
            {message && (
                <span role="status" className="text-sm">
                    {message}
                </span>
            )}
        </div>
    );
}
