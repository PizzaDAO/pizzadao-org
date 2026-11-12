"use client";

import { useMemo, useState } from "react";

const DEFAULT_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC"];

type Result = {
    status: string;
    event?: string;
    announcement?: string;
    general?: string;
    telegram?: string;
    eventUrl?: string | null;
    errors?: string[];
    error?: string;
};

const STEP_LABEL: Record<string, string> = {
    done: "done",
    already: "already done earlier",
    skipped: "not configured / off",
    failed: "failed (press Schedule again to retry)",
    uncertain: "unclear; check Discord before retrying",
};

export default function SessionForm({ enabled, crewId }: { enabled: boolean; crewId: string }) {
    const localZone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
        } catch {
            return "America/New_York";
        }
    }, []);
    const zones = DEFAULT_ZONES.includes(localZone) ? DEFAULT_ZONES : [localZone, ...DEFAULT_ZONES];
    const [f, setF] = useState({ title: "", presenter: "", description: "", date: "", time: "", timeZone: localZone, lengthMinutes: 60 });
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<Result | null>(null);
    const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

    const ready = !!(f.title && f.date && f.time);
    function preview() {
        setPreviewError(null);
        const qs = new URLSearchParams({ title: f.title, presenter: f.presenter, date: f.date, time: f.time, timeZone: f.timeZone });
        setPreviewSrc(`/api/crew/${crewId}/sessions/flyer?${qs}&t=${Date.now()}`);
    }

    async function schedule() {
        setBusy(true);
        setResult(null);
        try {
            const res = await fetch(`/api/crew/${crewId}/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(f),
            });
            const json = (await res.json().catch(() => ({}))) as Result;
            setResult(res.ok || json.status ? json : { status: "error", error: json.error ?? `Failed (${res.status})` });
        } catch {
            setResult({ status: "error", error: "Network error. Nothing was confirmed; check Discord before retrying." });
        } finally {
            setBusy(false);
        }
    }

    const input = "w-full border border-foreground/20 rounded px-3 py-2 bg-transparent";
    return (
        <div className="space-y-4">
            {!enabled && (
                <p className="rounded border border-foreground/20 p-3 text-sm">
                    Posting is switched off. You can preview the flyer, but Schedule will not create anything until an admin turns it on.
                </p>
            )}
            <label className="block">
                <span className="text-sm">Title</span>
                <input className={input} maxLength={100} value={f.title} onChange={(e) => set("title", e.target.value)} />
            </label>
            <label className="block">
                <span className="text-sm">Presenter (optional)</span>
                <input className={input} maxLength={100} value={f.presenter} onChange={(e) => set("presenter", e.target.value)} />
            </label>
            <label className="block">
                <span className="text-sm">Description</span>
                <textarea className={input} rows={5} maxLength={1000} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
                <label className="block">
                    <span className="text-sm">Date</span>
                    <input type="date" className={input} value={f.date} onChange={(e) => set("date", e.target.value)} />
                </label>
                <label className="block">
                    <span className="text-sm">Start time</span>
                    <input type="time" className={input} value={f.time} onChange={(e) => set("time", e.target.value)} />
                </label>
                <label className="block">
                    <span className="text-sm">Time zone</span>
                    <select className={input} value={f.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
                        {zones.map((z) => (
                            <option key={z} value={z}>
                                {z}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block">
                    <span className="text-sm">Length (minutes)</span>
                    <input type="number" min={15} max={480} step={15} className={input} value={f.lengthMinutes} onChange={(e) => set("lengthMinutes", Number(e.target.value))} />
                </label>
            </div>

            <div className="flex gap-3">
                <button type="button" disabled={!ready} onClick={preview} className="border border-foreground/30 rounded px-4 py-2 disabled:opacity-40">
                    Preview flyer
                </button>
                <button
                    type="button"
                    disabled={!ready || busy || !enabled || !f.description}
                    onClick={schedule}
                    className="rounded px-4 py-2 bg-foreground text-background disabled:opacity-40"
                >
                    {busy ? "Scheduling..." : "Schedule"}
                </button>
            </div>

            {previewSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="Flyer preview" className="w-full rounded border border-foreground/20" onError={() => setPreviewError("Could not build the flyer. Check the date and time.")} />
            )}
            {previewError && <p className="text-sm text-red-600">{previewError}</p>}

            {result && (
                <div className="rounded border border-foreground/20 p-3 text-sm space-y-1" role="status">
                    {result.status === "error" || result.status === "disabled" || result.status === "not-configured" ? (
                        <p>
                            {result.status === "disabled"
                                ? "Posting is switched off; nothing was created."
                                : result.status === "not-configured"
                                  ? "No Discord channels are set for sessions yet (admin settings); nothing was created."
                                  : result.error}
                        </p>
                    ) : (
                        <>
                            <p className="font-medium">{result.status === "scheduled" ? "Scheduled." : result.status === "already" ? "Already scheduled; nothing new was posted." : "Partly scheduled."}</p>
                            <ul className="list-disc pl-5">
                                <li>Discord event: {STEP_LABEL[result.event ?? "skipped"]}</li>
                                <li>Announcement: {STEP_LABEL[result.announcement ?? "skipped"]}</li>
                                <li>General announcements: {STEP_LABEL[result.general ?? "skipped"]}</li>
                                <li>Telegram: {STEP_LABEL[result.telegram ?? "skipped"]}</li>
                            </ul>
                            {result.eventUrl && (
                                <p>
                                    <a className="underline" href={result.eventUrl} target="_blank" rel="noreferrer">
                                        Open the Discord event
                                    </a>
                                </p>
                            )}
                            {result.errors?.map((e) => (
                                <p key={e} className="text-red-600">
                                    {e}
                                </p>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
