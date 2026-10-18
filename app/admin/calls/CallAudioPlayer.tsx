"use client";

// app/admin/calls/CallAudioPlayer.tsx
//
// Fetches short-lived signed R2 URLs on demand (never embedded in the page),
// so reloading is how a reviewer refreshes expired links.

import { useState } from "react";

interface AudioResponse {
    mix: string | null;
    tracks: Array<{ discordId: string; displayName: string | null; url: string }>;
}

export interface CallAudioLabels {
    load: string;
    loading: string;
    mix: string;
    tracks: string;
    expires: string;
    gone: string;
    error: string;
}

export function CallAudioPlayer({ recordingId, labels }: { recordingId: string; labels: CallAudioLabels }) {
    const [state, setState] = useState<"idle" | "loading" | "ready" | "gone" | "error">("idle");
    const [data, setData] = useState<AudioResponse | null>(null);

    async function load() {
        setState("loading");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/audio`, { cache: "no-store" });
            if (res.status === 410) return setState("gone");
            if (!res.ok) return setState("error");
            setData((await res.json()) as AudioResponse);
            setState("ready");
        } catch {
            setState("error");
        }
    }

    if (state === "gone") return <p className="m-0 text-foreground/60">{labels.gone}</p>;

    if (state !== "ready" || !data) {
        return (
            <div className="grid gap-2 justify-start">
                <button
                    type="button"
                    onClick={load}
                    disabled={state === "loading"}
                    className="btn-pill"
                    style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}
                >
                    {state === "loading" ? labels.loading : labels.load}
                </button>
                {state === "error" && <p className="m-0 text-tomato">{labels.error}</p>}
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {data.mix && (
                <div className="grid gap-1">
                    <span className="font-semibold">{labels.mix}</span>
                    <audio controls preload="none" src={data.mix} className="w-full" />
                </div>
            )}
            {data.tracks.length > 0 && (
                <div className="grid gap-2">
                    <span className="font-semibold">{labels.tracks}</span>
                    {data.tracks.map((tr) => (
                        <div key={tr.discordId} className="grid gap-1">
                            <span className="text-sm text-foreground/70">{tr.displayName ?? tr.discordId}</span>
                            <audio controls preload="none" src={tr.url} className="w-full" />
                        </div>
                    ))}
                </div>
            )}
            <p className="m-0 text-sm text-foreground/60">{labels.expires}</p>
        </div>
    );
}
