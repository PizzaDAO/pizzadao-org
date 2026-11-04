// Server component: intended local times of the recurring crew calls, where Discord has each one now,
// and the log of the DST sync (plans/dst-crew-call-times.md). Settings live in /admin/settings.
import { prisma } from "@/app/lib/db";
import { getSetting } from "@/app/lib/settings";
import { dstFixConfig, fetchCallEvents, intendedStart } from "@/app/lib/calls/event-time-sync";
import { wallTimeIn } from "@/app/lib/calls/zoned-time";
import { EventTimesActions } from "./EventTimesActions";

const local = (ms: number, zone: string) => {
    const w = wallTimeIn(ms, zone);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}`;
};

export default async function EventTimesPanel() {
    let rows: Awaited<ReturnType<typeof getSetting<"calls.eventLocalTimes">>> = [];
    let cfg: Awaited<ReturnType<typeof dstFixConfig>> | null = null;
    try {
        rows = await getSetting("calls.eventLocalTimes");
        cfg = await dstFixConfig();
    } catch (err) {
        console.error("[admin/calls] event times settings failed:", err instanceof Error ? err.message : err);
    }
    let events: Awaited<ReturnType<typeof fetchCallEvents>>["events"] | null = null;
    try {
        events = (await fetchCallEvents()).events;
    } catch (err) {
        console.error("[admin/calls] event times fetch failed:", err instanceof Error ? err.message : err);
    }
    const log = await prisma.discordEventTimeChange
        .findMany({ orderBy: { createdAt: "desc" }, take: 50 })
        .catch(() => null);

    return (
        <section className="grid gap-3">
            <h2 className="font-[family-name:var(--font-display)] font-black text-xl m-0">Crew call times (daylight saving)</h2>
            <p className="m-0 text-foreground/70">
                Discord repeats a recurring event at a fixed UTC time, so every call moves an hour in local time at a clock change. The table
                (<a href="/admin/settings" className="underline">Settings, Calls</a>) says when each should start locally; the sync moves the Discord event.
            </p>
            <p className="m-0 text-sm">
                {cfg === null
                    ? "Settings could not be read."
                    : !cfg.enabled
                      ? "The fix is OFF."
                      : cfg.dryRun
                        ? "The fix is ON in dry run: it only logs."
                        : "The fix is ON and will change Discord events."}
            </p>
            <EventTimesActions />
            {rows.length === 0 ? (
                <p className="text-foreground/60">No rows yet. Use Fill from Discord while the events are on the right local times.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left">
                                <th className="pr-3">Crew</th>
                                <th className="pr-3">Intended</th>
                                <th className="pr-3">Next start in Discord (UTC)</th>
                                <th className="pr-3">Next start (local)</th>
                                <th>Drift</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const e = events?.find((x) => x.id === r.eventId);
                                const target = e ? intendedStart(e.startMs, r) : null;
                                const drift = e && target !== null ? Math.round((target - e.startMs) / 60_000) : null;
                                return (
                                    <tr key={r.eventId}>
                                        <td className="pr-3">{r.label || r.eventId}</td>
                                        <td className="pr-3">
                                            {r.localTime} {r.timeZone}
                                        </td>
                                        <td className="pr-3">{e ? new Date(e.startMs).toISOString().slice(0, 16).replace("T", " ") : events ? "event not found" : "?"}</td>
                                        <td className="pr-3">{e ? local(e.startMs, r.timeZone) : ""}</td>
                                        <td>{drift === null ? "" : drift === 0 ? "none" : `${drift > 0 ? "+" : ""}${drift} min`}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <h3 className="font-bold m-0">Recent changes</h3>
            {log === null ? (
                <p className="text-foreground/60">The log could not be read (has the migration run?).</p>
            ) : log.length === 0 ? (
                <p className="text-foreground/60">Nothing logged yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left">
                                <th className="pr-3">When (UTC)</th>
                                <th className="pr-3">Event</th>
                                <th className="pr-3">Action</th>
                                <th className="pr-3">From</th>
                                <th className="pr-3">To</th>
                                <th>Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            {log.map((l) => (
                                <tr key={l.id}>
                                    <td className="pr-3">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                                    <td className="pr-3">{l.eventName || l.eventId}</td>
                                    <td className="pr-3">{l.action}</td>
                                    <td className="pr-3">{l.oldStart.toISOString().slice(0, 16).replace("T", " ")}</td>
                                    <td className="pr-3">{l.newStart ? l.newStart.toISOString().slice(0, 16).replace("T", " ") : ""}</td>
                                    <td>{l.error ?? ""}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
