"use client";

import { useCallback, useEffect, useState } from "react";

type Pool = { crewId: string; callDay: string; total: number; claimed: number };

export default function AdminPoapsClient() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [crewId, setCrewId] = useState("community_call");
  const [callDay, setCallDay] = useState("");
  const [links, setLinks] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/poaps");
    if (res.ok) setPools(((await res.json()) as { pools: Pool[] }).pools);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/admin/poaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crewId, callDay, links }),
    });
    const json = (await res.json().catch(() => ({}))) as { added?: number; duplicates?: number; invalid?: string[]; error?: string };
    if (res.ok) {
      setMsg(`Added ${json.added}, ${json.duplicates} duplicate, ${json.invalid?.length ?? 0} invalid.`);
      setLinks("");
      void load();
    } else {
      setMsg(`${json.error ?? "Failed"}${json.invalid?.length ? ` (${json.invalid.length} invalid)` : ""}`);
    }
  }

  const input = "min-h-11 px-3 rounded border border-foreground/25 bg-background text-base";
  return (
    <div className="grid gap-6">
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1 text-sm">Crew id (e.g. ops, community_call; must match CallAttendance.crewId)
          <input className={input} value={crewId} onChange={(e) => setCrewId(e.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">Call date (UTC day)
          <input className={input} type="date" value={callDay} onChange={(e) => setCallDay(e.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">POAP mint links (one per line; poap.xyz / poap.delivery only)
          <textarea className={`${input} min-h-40 py-2 font-mono text-sm`} value={links} onChange={(e) => setLinks(e.target.value)} required />
        </label>
        <button type="submit" className="btn-pill min-h-11 bg-foreground text-background justify-self-start">Add links</button>
        {msg && <p role="status" className="m-0">{msg}</p>}
      </form>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-foreground/60"><th className="p-2">Crew</th><th className="p-2">Day</th><th className="p-2">Claimed</th><th className="p-2">Total</th></tr></thead>
        <tbody>
          {pools.map((p) => (
            <tr key={`${p.crewId}${p.callDay}`} className="border-t border-foreground/10">
              <td className="p-2">{p.crewId}</td><td className="p-2">{p.callDay}</td><td className="p-2">{p.claimed}</td><td className="p-2">{p.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
