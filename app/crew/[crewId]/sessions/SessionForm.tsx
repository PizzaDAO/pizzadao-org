"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC"];

function allZones(local: string): string[] {
    let list: string[] = [];
    try {
        list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
        list = [];
    }
    const base = list.length ? list : DEFAULT_ZONES;
    const withUtc = base.includes("UTC") ? base : [...base, "UTC"];
    return withUtc.includes(local) ? withUtc : [local, ...withUtc];
}

type Result = {
    sessionId?: string;
    status: string;
    event?: string;
    announcement?: string;
    general?: string;
    telegram?: string;
    note?: string;
    eventUrl?: string | null;
    errors?: string[];
    error?: string;
};

type Preview = {
    ok: boolean;
    error?: string;
    announcement?: string;
    telegram?: string;
    event?: { name: string; description: string; when: string };
    destinations?: { event: string | null; announcement: string | null; general: string | null; telegram: boolean };
};

const STEP_LABEL: Record<string, string> = {
    done: "done",
    already: "already done earlier",
    skipped: "not configured / off / nothing to change",
    failed: "failed (use Retry on the manage page)",
    uncertain: "not retried automatically; ask an admin",
};

export interface SessionFormValues {
    title: string;
    presenter: string;
    description: string;
    date: string;
    time: string;
    timeZone: string;
    lengthMinutes: number;
    public: boolean;
    recordingUrl: string;
}

export default function SessionForm({
    enabled,
    crewId,
    isAdmin,
    mode = "create",
    sessionId,
    initial,
    defaultLengthMinutes = 60,
    descriptionTemplate = "",
    listingEnabled = false,
}: {
    enabled: boolean;
    crewId: string;
    isAdmin: boolean;
    mode?: "create" | "edit";
    sessionId?: string;
    initial?: SessionFormValues;
    defaultLengthMinutes?: number;
    descriptionTemplate?: string;
    listingEnabled?: boolean;
}) {
    const localZone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
        } catch {
            return "America/New_York";
        }
    }, []);
    const zones = useMemo(() => allZones(initial?.timeZone ?? localZone), [initial?.timeZone, localZone]);
    const [f, setF] = useState<SessionFormValues>(
        initial ?? { title: "", presenter: "", description: descriptionTemplate, date: "", time: "", timeZone: localZone, lengthMinutes: defaultLengthMinutes, public: true, recordingUrl: "" },
    );
    const [notify, setNotify] = useState(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [text, setText] = useState<Preview | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<Result | null>(null);
    const set = <K extends keyof SessionFormValues>(k: K, v: SessionFormValues[K]) => setF((p) => ({ ...p, [k]: v }));

    const [resetMsg, setResetMsg] = useState<string | null>(null);
    async function resetStuck(id: string) {
        if (!window.confirm("Check Discord first: if the event or post for this session already exists, delete it or leave it and do not retry. Clear the stuck steps so Retry can run them again?")) return;
        const res = await fetch(`/api/crew/${crewId}/sessions/${id}/reset`, { method: "POST" });
        const j = (await res.json().catch(() => ({}))) as { cleared?: number; error?: string };
        setResetMsg(res.ok ? `Cleared ${j.cleared ?? 0} step(s). Retry it from the manage page.` : (j.error ?? "Could not clear."));
    }

    const ready = !!(f.title && f.date && f.time);

    // Live preview: the flyer image and the announcement text follow the form (debounced).
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        if (!ready) return;
        const ctl = new AbortController();
        timer.current = setTimeout(() => {
            setPreviewError(null);
            const qs = new URLSearchParams({ title: f.title, presenter: f.presenter, date: f.date, time: f.time, timeZone: f.timeZone });
            setPreviewSrc(`/api/crew/${crewId}/sessions/flyer?${qs}`);
            fetch(`/api/crew/${crewId}/sessions/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f), signal: ctl.signal })
                .then((r) => (r.ok ? (r.json() as Promise<Preview>) : null))
                .then((j) => j && setText(j))
                .catch(() => {});
        }, 600);
        return () => {
            if (timer.current) clearTimeout(timer.current);
            ctl.abort();
        };
    }, [f, ready, crewId]);

    // Discord renders <t:unix:F> in each reader's zone; show the same in the preview.
    const shownAnnouncement = (text?.announcement ?? "").replace(/<t:(\d+):([FR])>/g, (_m, u: string, k: string) =>
        k === "R" ? "in a while" : new Date(Number(u) * 1000).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }),
    );

    async function save() {
        setBusy(true);
        setResult(null);
        try {
            const res = await fetch(mode === "edit" ? `/api/crew/${crewId}/sessions/${sessionId}` : `/api/crew/${crewId}/sessions`, {
                method: mode === "edit" ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mode === "edit" ? { ...f, notify } : f),
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
    const dest = text?.destinations;
    const shareText = `Join us: ${f.title}`;
    const done = result && ["scheduled", "partial", "already", "edited"].includes(result.status);
    return (
        <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
                {!enabled && (
                    <p className="rounded border border-foreground/20 p-3 text-sm">
                        Posting is switched off. You can preview, but {mode === "edit" ? "Save" : "Schedule"} will not change anything until an admin turns it on.
                    </p>
                )}
                <label className="block">
                    <span className="text-sm">Title</span>
                    <input className={input} maxLength={100} value={f.title} onChange={(e) => set("title", e.target.value)} />
                </label>
                <label className="block">
                    <span className="text-sm">Presenter (optional, shown publicly as typed)</span>
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
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.public} onChange={(e) => set("public", e.target.checked)} />
                    Show on the public sessions page{listingEnabled ? "" : " (when it is switched on)"}
                </label>
                {mode === "edit" && (
                    <>
                        <label className="block">
                            <span className="text-sm">Recording link (optional, https)</span>
                            <input className={input} maxLength={500} value={f.recordingUrl} onChange={(e) => set("recordingUrl", e.target.value)} />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                            Post a short &quot;updated&quot; reply under the announcement
                        </label>
                    </>
                )}

                <div className="flex gap-3">
                    <button type="button" disabled={!ready || busy || !enabled || !f.description} onClick={save} className="rounded px-4 py-2 bg-foreground text-background disabled:opacity-40">
                        {busy ? "Saving..." : mode === "edit" ? "Save changes" : "Schedule"}
                    </button>
                    <Link href={`/crew/${crewId}/sessions`} className="border border-foreground/30 rounded px-4 py-2 no-underline">
                        {done ? "Back to sessions" : "Cancel"}
                    </Link>
                </div>

                {result && (
                    <div className="rounded border border-foreground/20 p-3 text-sm space-y-1" role="status">
                        {!done ? (
                            <p>
                                {result.status === "disabled"
                                    ? "Posting or editing is switched off; nothing was changed."
                                    : result.status === "not-configured"
                                      ? "No Discord channels are set for sessions yet (admin settings); nothing was created."
                                      : result.status === "canceled"
                                        ? "This session is canceled."
                                        : result.status === "ended"
                                          ? "This session already ended."
                                          : (result.error ?? "Could not save.")}
                            </p>
                        ) : (
                            <>
                                <p className="font-medium">
                                    {result.status === "scheduled" ? "Scheduled." : result.status === "edited" ? "Saved. The Discord event and posts were updated in place." : result.status === "already" ? "Already scheduled; nothing new was posted." : "Partly done."}
                                </p>
                                <ul className="list-disc pl-5">
                                    <li>Discord event: {STEP_LABEL[result.event ?? "skipped"]}</li>
                                    <li>Announcement: {STEP_LABEL[result.announcement ?? "skipped"]}</li>
                                    <li>General announcements: {STEP_LABEL[result.general ?? "skipped"]}</li>
                                    {mode === "create" && <li>Telegram: {STEP_LABEL[result.telegram ?? "skipped"]}</li>}
                                    {result.note && <li>Update reply: {STEP_LABEL[result.note]}</li>}
                                </ul>
                                {result.eventUrl && (
                                    <p>
                                        <a className="underline" href={result.eventUrl} target="_blank" rel="noreferrer">
                                            Open the Discord event
                                        </a>
                                    </p>
                                )}
                                {mode === "create" && (
                                    <p className="space-x-3">
                                        {listingEnabled && f.public && (
                                            <Link className="underline" href="/learn">
                                                Public page
                                            </Link>
                                        )}
                                        <a className="underline" target="_blank" rel="noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}${result.eventUrl ? `&url=${encodeURIComponent(result.eventUrl)}` : ""}`}>
                                            Share on X
                                        </a>
                                    </p>
                                )}
                                {isAdmin && result.sessionId && [result.event, result.announcement, result.general].includes("uncertain") && (
                                    <p>
                                        <button type="button" className="underline" onClick={() => resetStuck(result.sessionId!)}>
                                            Clear stuck steps (admin)
                                        </button>
                                        {resetMsg && <span className="ml-2">{resetMsg}</span>}
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

            <aside className="space-y-4" aria-label="Preview">
                <h2 className="text-lg">Preview</h2>
                {!ready && <p className="text-sm text-foreground/60">Add a title, date and time to see the flyer and the announcement.</p>}
                {previewSrc && ready && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewSrc} alt="Flyer preview" className="w-full rounded border border-foreground/20" onError={() => setPreviewError("Could not build the flyer. Check the date and time.")} />
                )}
                {previewError && <p className="text-sm text-red-600">{previewError}</p>}
                {text && !text.ok && <p className="text-sm text-red-600">{text.error}</p>}
                {text?.ok && ready && (
                    <>
                        <div>
                            <p className="text-sm text-foreground/60">Announcement</p>
                            <pre className="whitespace-pre-wrap break-words rounded border border-foreground/20 p-3 text-sm font-sans">{shownAnnouncement}</pre>
                        </div>
                        {text.event && (
                            <div>
                                <p className="text-sm text-foreground/60">Discord event</p>
                                <div className="rounded border border-foreground/20 p-3 text-sm">
                                    <p className="font-medium">{text.event.name}</p>
                                    <p>{text.event.when}</p>
                                    <p className="whitespace-pre-wrap text-foreground/70">{text.event.description}</p>
                                </div>
                            </div>
                        )}
                        {dest && (
                            <p className="text-sm text-foreground/70">
                                {mode === "edit" ? "Updates in place" : "Posts to"}: {[dest.event && `event in #${dest.event}`, dest.announcement && `#${dest.announcement}`, dest.general && `#${dest.general}`, dest.telegram && mode === "create" && "Telegram"].filter(Boolean).join(", ") || "no channels are set yet"}
                            </p>
                        )}
                    </>
                )}
            </aside>
        </div>
    );
}
