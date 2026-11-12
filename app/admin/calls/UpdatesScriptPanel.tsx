// Server component: the spoken call-updates script Metalhead's /metalhead updates would read for a crew
// (read-only: nothing is played or generated here).
import { buildCrewScript } from "@/app/lib/call-updates/sources";

export default async function UpdatesScriptPanel({ crewId }: { crewId: string }) {
    const s = await buildCrewScript(crewId).catch(() => null);
    return (
        <details className="text-sm">
            <summary className="cursor-pointer">Spoken updates script</summary>
            {s === null || s.kind === "none" ? (
                <p className="m-0 mt-2 text-foreground/60">
                    {s === null ? "Could not build the script." : s.reason === "empty" ? "Nothing to read right now (nothing would play)." : `No script (${s.reason}).`}
                </p>
            ) : (
                <div className="mt-2 grid gap-2">
                    <p className="m-0 text-foreground/60">
                        About {s.estSeconds} seconds, {s.sections.length} clips.
                        {s.dropped.length > 0 && ` Left out to fit the time limit: ${s.dropped.join(", ")}.`}
                    </p>
                    <pre className="m-0 whitespace-pre-wrap font-sans">{s.text}</pre>
                </div>
            )}
        </details>
    );
}
