"use client";

import { useState } from "react";
import type { MergeReport } from "@/app/lib/members/merge";

type Phase = "idle" | "loading" | "preview" | "done";

export function MergeClient() {
    const [keepId, setKeepId] = useState("");
    const [removeId, setRemoveId] = useState("");
    const [phase, setPhase] = useState<Phase>("idle");
    const [report, setReport] = useState<MergeReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function call(apply: boolean) {
        setError(null);
        setPhase("loading");
        try {
            const res = await fetch("/api/admin/members/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keepId: keepId.trim(), removeId: removeId.trim(), apply }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Request failed");
            setReport(data.report as MergeReport);
            setPhase(apply ? "done" : "preview");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Request failed");
            setPhase(report && !apply ? "preview" : "idle");
        }
    }

    function reset() {
        setPhase("idle");
        setReport(null);
        setError(null);
    }

    const busy = phase === "loading";
    const input = "rounded border border-foreground/20 bg-transparent px-3 py-2 w-full";

    return (
        <div className="grid gap-5">
            <form
                className="grid gap-3 md:grid-cols-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void call(false);
                }}
            >
                <label className="grid gap-1">
                    <span>Member to keep (ID)</span>
                    <input className={input} value={keepId} onChange={(e) => { setKeepId(e.target.value); if (phase !== "idle") reset(); }} disabled={busy} />
                </label>
                <label className="grid gap-1">
                    <span>Member to remove (ID)</span>
                    <input className={input} value={removeId} onChange={(e) => { setRemoveId(e.target.value); if (phase !== "idle") reset(); }} disabled={busy} />
                </label>
                <div className="md:col-span-2">
                    <button type="submit" className="rounded border border-foreground/30 px-4 py-2" disabled={busy || !keepId.trim() || !removeId.trim()}>
                        {busy ? "Working..." : "Preview merge"}
                    </button>
                </div>
            </form>

            {error && <p role="alert" className="text-tomato m-0">{error}</p>}

            {report && (
                <section className="grid gap-3">
                    <h2 className="text-xl m-0">
                        {phase === "done" ? "Merged" : "Preview"}: {report.removeId} into {report.keepId}
                    </h2>
                    <p className="m-0">
                        {report.totals.moved} rows move, {report.totals.dropped} duplicates dropped, {report.totals.collisions} collisions.
                    </p>
                    <p className="m-0">
                        Discord: {report.discord.action}
                        {report.pep ? `. PEP: ${report.pep.moved} moves to the kept account through the ledger.` : ""}
                    </p>
                    {report.notes.map((n) => (
                        <p key={n} className="m-0 text-foreground/70">{n}</p>
                    ))}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className="pr-3">Table</th>
                                    <th className="pr-3">Column</th>
                                    <th className="pr-3">Move</th>
                                    <th className="pr-3">Drop</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.tables
                                    .filter((t) => t.moved || t.dropped)
                                    .map((t) => (
                                        <tr key={`${t.table}.${t.column}`} className="align-top">
                                            <td className="pr-3">{t.table}</td>
                                            <td className="pr-3">{t.column}</td>
                                            <td className="pr-3">{t.moved}</td>
                                            <td className="pr-3">
                                                {t.dropped}
                                                {t.collisions.map((c) => (
                                                    <div key={c} className="text-foreground/60">{c}</div>
                                                ))}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                    {phase === "preview" && (
                        <div className="flex gap-3">
                            <button
                                type="button"
                                className="rounded border border-tomato px-4 py-2 text-tomato"
                                disabled={busy}
                                onClick={() => {
                                    if (window.confirm(`Merge ${report.removeId} into ${report.keepId}? This cannot be undone from this page.`)) void call(true);
                                }}
                            >
                                Confirm merge
                            </button>
                            <button type="button" className="rounded border border-foreground/30 px-4 py-2" onClick={reset}>
                                Cancel
                            </button>
                        </div>
                    )}
                    {phase === "done" && (
                        <button type="button" className="rounded border border-foreground/30 px-4 py-2 w-fit" onClick={() => { setKeepId(""); setRemoveId(""); reset(); }}>
                            Merge another
                        </button>
                    )}
                </section>
            )}
        </div>
    );
}
