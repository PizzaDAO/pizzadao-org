"use client";

// app/admin/calls/RecordingsTable.tsx
//
// The review list, with bulk publish / reject for imported calls. Discord-recorded calls have no checkbox:
// they are reviewed one at a time. The server enforces the same rules (and the per-click cap).

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export interface RecordingRow {
    id: string;
    when: string;
    eventName: string | null;
    partial: boolean;
    crewLabel: string | null;
    minutes: number;
    speakers: number;
    status: string;
    imported: boolean;
}

type BulkAction = "publish" | "reject";

export function RecordingsTable({ rows, bulkMax }: { rows: RecordingRow[]; bulkMax: number }) {
    const t = useTranslations("adminCalls");
    const router = useRouter();
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [state, setState] = useState<"idle" | "working" | "error">("idle");
    const [message, setMessage] = useState<string | null>(null);

    const selectable = rows.filter((r) => r.imported && r.status !== "REJECTED" && r.status !== "PROCESSING");
    const selectableIds = new Set(selectable.map((r) => r.id));
    const allPicked = selectable.length > 0 && selectable.slice(0, bulkMax).every((r) => picked.has(r.id));

    function toggle(id: string) {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function run(action: BulkAction) {
        const ids = [...picked];
        if (ids.length === 0) return;
        if (ids.length > bulkMax) return setMessage(t("bulkTooMany", { max: bulkMax }));
        if (!window.confirm(action === "publish" ? t("bulkConfirmPublish", { count: ids.length }) : t("bulkConfirmReject", { count: ids.length }))) return;
        setState("working");
        setMessage(null);
        try {
            const res = await fetch("/api/admin/calls/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ids, confirm: true }),
            });
            const data = (await res.json().catch(() => null)) as { counts?: Record<string, number> } | null;
            if (!res.ok || !data?.counts) {
                setState("error");
                return;
            }
            const counts = data.counts;
            const done = (counts.ok ?? 0) + (counts.rejected ?? 0);
            const skipped = Object.entries(counts).filter(([k]) => k !== "ok" && k !== "rejected");
            const skippedTotal = skipped.reduce((n, [, c]) => n + c, 0);
            const detail = skipped.map(([k, c]) => `${c} ${t.has(`bulkReasons.${k}`) ? t(`bulkReasons.${k}`) : k}`).join("; ");
            setMessage(`${t("bulkResult", { done, skipped: skippedTotal })}${detail ? ` ${detail}.` : ""}`);
            setPicked(new Set());
            setState("idle");
            router.refresh();
        } catch {
            setState("error");
        }
    }

    return (
        <div className="grid gap-3">
            {selectable.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="inline-flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={allPicked}
                            onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.slice(0, bulkMax).map((r) => r.id)))}
                        />
                        {t("bulkSelectAll")}
                    </label>
                    {picked.size > 0 && (
                        <>
                            <span className="text-foreground/70">{t("bulkSelected", { count: picked.size })}</span>
                            <button type="button" disabled={state === "working"} onClick={() => run("publish")} className="underline">
                                {state === "working" ? t("bulkWorking") : t("bulkPublish")}
                            </button>
                            <button type="button" disabled={state === "working"} onClick={() => run("reject")} className="underline text-tomato">
                                {t("bulkReject")}
                            </button>
                        </>
                    )}
                    {state === "error" && <span className="text-tomato">{t("bulkError")}</span>}
                    {message && <span role="status">{message}</span>}
                </div>
            )}
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-foreground/60">
                            <th className="p-3 w-8" />
                            <th className="p-3">{t("colWhen")}</th>
                            <th className="p-3">{t("colCall")}</th>
                            <th className="p-3">{t("colCrew")}</th>
                            <th className="p-3">{t("colSource")}</th>
                            <th className="p-3">{t("colDuration")}</th>
                            <th className="p-3">{t("colSpeakers")}</th>
                            <th className="p-3">{t("colStatus")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id} className="border-t" style={{ borderColor: "hsl(var(--rule-warm) / 0.35)" }}>
                                <td className="p-3">
                                    {selectableIds.has(r.id) && (
                                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={t("bulkSelect", { name: r.eventName ?? r.when })} />
                                    )}
                                </td>
                                <td className="p-3 whitespace-nowrap">
                                    <Link href={`/admin/calls/${r.id}`} className="underline">
                                        {r.when}
                                    </Link>
                                </td>
                                <td className="p-3">
                                    {r.eventName ?? "-"}
                                    {r.partial && <span className="ml-2 text-tomato">{t("partial")}</span>}
                                </td>
                                <td className="p-3">{r.crewLabel ?? <span className="text-foreground/50">{t("noCrew")}</span>}</td>
                                <td className="p-3 whitespace-nowrap">{r.imported ? t("sourceBadgeX") : t("sourceBadgeDiscord")}</td>
                                <td className="p-3 whitespace-nowrap">{t("minutes", { count: r.minutes })}</td>
                                <td className="p-3">{r.speakers}</td>
                                <td className="p-3">{t(`status.${r.status}`)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
