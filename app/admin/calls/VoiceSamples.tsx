"use client";

// Admin: hear a few base voices for the spoken call updates. Plays in this browser only, never in Discord.
import { useRef, useState } from "react";

export default function VoiceSamples({ voices, current, enabled }: { voices: readonly string[]; current: string; enabled: boolean }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const audio = useRef<HTMLAudioElement | null>(null);

    async function play(voice: string) {
        setBusy(voice);
        setError(null);
        try {
            const res = await fetch("/api/admin/calls/updates-sample", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ voice }),
            });
            if (!res.ok) {
                const j = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(j?.error ?? `HTTP ${res.status}`);
            }
            const url = URL.createObjectURL(await res.blob());
            audio.current?.pause();
            const a = new Audio(url);
            audio.current = a;
            a.onended = () => URL.revokeObjectURL(url);
            await a.play();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not play the sample");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="grid gap-2">
            <p className="m-0 text-sm text-foreground/70">
                Voice samples (this browser only, never Discord). The saved base voice is <strong>{current}</strong>; change it in settings.
            </p>
            {!enabled && <p className="m-0 text-sm text-foreground/60">Samples are only available on production.</p>}
            <div className="flex flex-wrap gap-2">
                {voices.map((v) => (
                    <button
                        key={v}
                        type="button"
                        disabled={!enabled || busy !== null}
                        onClick={() => play(v)}
                        className="rounded-full border px-3 py-1 text-sm disabled:opacity-50"
                        style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                    >
                        {busy === v ? "Generating..." : `Generate sample: ${v}`}
                    </button>
                ))}
            </div>
            {error && <p className="m-0 text-sm text-tomato">{error}</p>}
        </div>
    );
}
