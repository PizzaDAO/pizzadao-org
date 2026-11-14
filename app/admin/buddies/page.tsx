"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Overview = {
  enabled: boolean;
  introThreadsEnabled: boolean;
  rewardEnabled: boolean;
  cap: number;
  completionLevel: number;
  buddies: { discordId: string; name: string; active: boolean; paused: boolean; maxActive: number; activeCount: number; capacity: number; addedBy: string | null }[];
  trainees: { discordId: string; name: string }[];
  traineesTruncated: boolean;
  pairs: { id: string; status: string; trainee: { discordId: string; name: string }; buddy: { discordId: string; name: string }; threadId: string | null; createdAt: string; endedReason: string | null; lastEvent: string | null }[];
};

const ACTIVE = ["QUEUED", "MATCHED", "INTRODUCED"];

export default function BuddiesPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [newBuddy, setNewBuddy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/buddies", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "Log in with an administrator account to use this page." : "The buddy overview is unavailable. Please retry.");
      setData((await r.json()) as Overview);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, done: (res: Record<string, unknown>) => string) {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/admin/buddies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const res = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      setNotice(r.ok ? done(res) : String(res.error ?? "That did not work."));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const availableBuddies = useMemo(() => (data?.buddies ?? []).filter((b) => b.active && !b.paused && b.activeCount < b.capacity), [data]);
  const trainees = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.trainees ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.discordId.includes(q));
  }, [data, filter]);

  const introNote = (res: Record<string, unknown>) => {
    const intro = res.intro as { mode?: string; ok?: boolean; reason?: string; waiting?: boolean } | undefined;
    if (!intro) return "Paired.";
    if (!intro.ok && intro.waiting) return "Paired. Waiting for channel access: the intro opens once both people can see the buddy channel.";
    if (!intro.ok) return `Paired. The intro thread failed (${intro.reason}); use Retry intro.`;
    return intro.mode === "dry-run" ? "Paired. Intro threads are off, so nothing was posted (recorded as a dry run)." : "Paired and the intro thread is open.";
  };

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <h1 className="font-display text-4xl font-bold">Buddies</h1>
      <p className="my-4">Pair new members with an experienced member. A pair finishes when the trainee completes missions Level {data?.completionLevel ?? 2}.</p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading…</p>}
      {notice && <p role="status" className="my-3 font-semibold">{notice}</p>}
      {data && (
        <>
          {!data.enabled && <p role="alert" className="my-3">The buddy system is switched off in settings (Buddy system), so pairs cannot be made yet.</p>}
          <p className="text-sm">Intro threads: {data.introThreadsEnabled ? "on" : "off (dry run)"}. Buddy reward: {data.rewardEnabled ? "on" : "off (dry run)"}. Edit these in /admin/settings.</p>

          <h2 className="mt-8 text-2xl font-bold">Buddies</h2>
          {data.buddies.length === 0 ? <p>No buddies yet.</p> : (
            <table className="w-full text-left">
              <thead><tr><th className="py-2">Name</th><th>Load</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.buddies.map((b) => (
                  <tr key={b.discordId} className="border-t border-foreground/20">
                    <td className="py-2">{b.name}{b.addedBy ? " (added by an admin)" : ""}</td>
                    <td>{b.activeCount} / {b.capacity}</td>
                    <td>{!b.active ? "Not a buddy" : b.paused ? "Paused" : "Available"}</td>
                    <td>{b.active && <button type="button" disabled={busy} onClick={() => act({ action: "removeBuddy", discordId: b.discordId }, () => "Removed from the pool.")}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "addBuddy", discordId: newBuddy.trim() }, () => "Added as a buddy."); setNewBuddy(""); }}>
            <label className="sr-only" htmlFor="new-buddy">Discord id to add as a buddy</label>
            <input id="new-buddy" className="rounded border px-2 py-1" placeholder="Discord id" value={newBuddy} onChange={(e) => setNewBuddy(e.target.value)} />
            <button type="submit" disabled={busy || !newBuddy.trim()}>Add a buddy by hand</button>
          </form>

          <h2 className="mt-8 text-2xl font-bold">Members without a buddy</h2>
          <p className="text-sm">Signed-up members who have not completed Level {data.completionLevel} and have no active buddy.{data.traineesTruncated ? " Only the first part of the list is shown; use the filter." : ""}</p>
          <label className="sr-only" htmlFor="filter">Filter</label>
          <input id="filter" className="my-2 rounded border px-2 py-1" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="grid gap-2 p-0" style={{ listStyle: "none" }}>
            {trainees.slice(0, 50).map((t) => (
              <li key={t.discordId} className="flex flex-wrap items-center gap-2 border-t border-foreground/20 py-2">
                <span className="min-w-[10rem] font-semibold">{t.name}</span>
                <select aria-label={`Buddy for ${t.name}`} value={choice[t.discordId] ?? ""} onChange={(e) => setChoice({ ...choice, [t.discordId]: e.target.value })}>
                  <option value="">Choose a buddy</option>
                  {availableBuddies.map((b) => <option key={b.discordId} value={b.discordId}>{b.name} ({b.activeCount}/{b.capacity})</option>)}
                </select>
                <button type="button" disabled={busy || !choice[t.discordId] || !data.enabled} onClick={() => act({ action: "pair", traineeDiscordId: t.discordId, buddyDiscordId: choice[t.discordId] }, introNote)}>Pair</button>
              </li>
            ))}
          </ul>
          {trainees.length > 50 && <p className="text-sm">Showing 50 of {trainees.length}. Narrow with the filter.</p>}

          <h2 className="mt-8 text-2xl font-bold">Pairs</h2>
          {data.pairs.length === 0 ? <p>No pairs yet.</p> : (
            <table className="w-full text-left">
              <thead><tr><th className="py-2">Trainee</th><th>Buddy</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.pairs.map((p) => (
                  <tr key={p.id} className="border-t border-foreground/20">
                    <td className="py-2">{p.trainee.name}</td>
                    <td>{p.buddy.name}</td>
                    <td>{p.status}{p.endedReason ? ` (${p.endedReason})` : ""}{p.lastEvent === "intro_failed" ? " - intro failed" : ""}{p.lastEvent === "intro_deferred" ? " - Waiting for channel access" : ""}{p.lastEvent === "intro_uncertain" ? " - intro post unclear: check the thread, then Retry intro" : ""}</td>
                    <td className="whitespace-nowrap">
                      {ACTIVE.includes(p.status) && !p.threadId && <button type="button" disabled={busy} onClick={() => act({ action: "introduce", pairId: p.id }, (r) => (r.ok ? (r.mode === "dry-run" ? "Dry run recorded; nothing was posted." : "Intro thread opened.") : r.waiting ? "Waiting for channel access: the member cannot see the buddy channel yet." : r.cancelled ? "Cancelled: still no channel access after the wait. The trainee is unmatched again." : `Intro failed: ${String(r.reason)}`))}>Retry intro</button>}
                      {ACTIVE.includes(p.status) && <button type="button" className="ml-2" disabled={busy} onClick={() => { if (confirm(`End the pairing of ${p.trainee.name} and ${p.buddy.name}?`)) void act({ action: "end", pairId: p.id }, () => "Pair ended."); }}>End</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-6"><button type="button" disabled={busy || !data.enabled} onClick={() => act({ action: "completeDue" }, (r) => `Checked ${String(r.checked)} pairs, completed ${String(r.completed)}.`)}>Check for finished pairs now</button></p>
        </>
      )}
    </main>
  );
}
