"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Per-session buttons on the manage page: Edit, Cancel, Retry failed steps, Copy link, Clear stuck (admin). */
export default function SessionActions({
    crewId,
    sessionId,
    editEnabled,
    canceled,
    ended,
    hasMissing,
    hasStuck,
    isAdmin,
    publicLink,
}: {
    crewId: string;
    sessionId: string;
    editEnabled: boolean;
    canceled: boolean;
    ended: boolean;
    hasMissing: boolean;
    hasStuck: boolean;
    isAdmin: boolean;
    publicLink: string | null;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const base = `/api/crew/${crewId}/sessions/${sessionId}`;

    async function call(label: string, path: string, confirmText?: string) {
        if (confirmText && !window.confirm(confirmText)) return;
        setBusy(label);
        setMsg(null);
        try {
            const res = await fetch(`${base}${path}`, { method: "POST" });
            const j = (await res.json().catch(() => ({}))) as { status?: string; errors?: string[]; error?: string; cleared?: number };
            if (!res.ok && !j.status) setMsg(j.error ?? `Failed (${res.status})`);
            else if (j.status === "disabled") setMsg("Switched off by an admin.");
            else if (j.errors?.length) setMsg(j.errors.join(" | "));
            else setMsg(label === "Clear" ? `Cleared ${j.cleared ?? 0} step(s).` : "Done.");
            router.refresh();
        } catch {
            setMsg("Network error. Check Discord before retrying.");
        } finally {
            setBusy(null);
        }
    }

    const btn = "border border-foreground/30 rounded px-3 py-1 text-sm disabled:opacity-40 no-underline";
    const live = !canceled && !ended;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {live && editEnabled && (
                <Link href={`/crew/${crewId}/sessions/${sessionId}/edit`} className={btn}>
                    Edit
                </Link>
            )}
            {live && editEnabled && hasMissing && (
                <button type="button" className={btn} disabled={!!busy} onClick={() => call("Retry", "/retry")}>
                    {busy === "Retry" ? "Retrying..." : "Retry failed steps"}
                </button>
            )}
            {live && editEnabled && (
                <button type="button" className={btn} disabled={!!busy} onClick={() => call("Cancel", "/cancel", "Cancel this session? The Discord event is canceled and the announcement is edited to say so.")}>
                    {busy === "Cancel" ? "Canceling..." : "Cancel session"}
                </button>
            )}
            {canceled && editEnabled && (
                <button type="button" className={btn} disabled={!!busy} onClick={() => call("Cancel", "/cancel")}>
                    Re-run cancel steps
                </button>
            )}
            {publicLink && (
                <button type="button" className={btn} onClick={() => navigator.clipboard?.writeText(publicLink).then(() => setMsg("Link copied."))}>
                    Copy link
                </button>
            )}
            {isAdmin && hasStuck && (
                <button type="button" className={btn} disabled={!!busy} onClick={() => call("Clear", "/reset", "Check Discord first: if the event or post already exists, delete it or leave it and do not retry. Clear the stuck steps so Retry can run them again?")}>
                    Clear stuck steps (admin)
                </button>
            )}
            {msg && <span className="text-sm text-foreground/70">{msg}</span>}
        </div>
    );
}
