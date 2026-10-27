"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  enabled: boolean;
  ready: "ok" | "disabled" | "misconfigured";
  contract: { address: string; url: string } | null;
  minter: { address: string; balanceEth: string; low: boolean } | null;
  daily: { used: number; cap: number };
  counts: Record<string, number>;
  failed: { id: string; discordId: string; callId: number; attempts: number; lastError: string | null }[];
  stuck: { id: string; callId: number; txHash: string | null; submittedAt: string | null }[];
  calls: { id: number; crewId: string; crewLabel: string; callDay: string; imageUrl: string | null; claims: number }[];
  crews: { id: string; label: string; artUrl: string | null }[];
};

const btn = "min-h-11 px-4 rounded-full border border-foreground/25 bg-background text-sm cursor-pointer";

export default function AdminSlicesClient() {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/slices", { cache: "no-store" });
    if (res.ok) setS((await res.json()) as Status);
    else setMsg("Could not load status");
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, label: string) {
    setMsg(`${label}…`);
    const res = await fetch("/api/admin/slices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; result?: unknown };
    setMsg(res.ok ? `${label}: done${json.result ? ` ${JSON.stringify(json.result)}` : ""}` : `${label}: ${json.error ?? "failed"}`);
    void load();
  }

  async function upload(crewId: string, file: File | undefined) {
    if (!file) return;
    setMsg(`Uploading art for ${crewId}…`);
    const form = new FormData();
    form.set("crewId", crewId);
    form.set("file", file);
    const res = await fetch("/api/admin/slices/art", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? `Art saved for ${crewId}. It applies to calls created from now on; re-render older calls below.` : json.error ?? "Upload failed");
    void load();
  }

  async function removeArt(crewId: string) {
    await fetch("/api/admin/slices/art", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crewId }) });
    void load();
  }

  if (!s) return <p>{msg ?? "Loading…"}</p>;
  const c = s.counts;
  return (
    <div className="grid gap-8">
      {msg && <p role="status" className="m-0">{msg}</p>}

      <section className="grid gap-2">
        <h2 className="text-xl font-black m-0">Status</h2>
        <p className="m-0">
          Kill switch: <strong>{s.enabled ? "ON (minting)" : "OFF (claims queue, nothing mints)"}</strong>
          {s.ready === "misconfigured" && " - env incomplete (contract / minter key / RPC)"}
        </p>
        {s.contract && <p className="m-0 text-sm">Contract: <a className="underline" href={s.contract.url} target="_blank" rel="noopener noreferrer">{s.contract.address}</a></p>}
        {s.minter && (
          <p className="m-0 text-sm">
            Minter {s.minter.address}: <strong>{s.minter.balanceEth} ETH</strong>
            {s.minter.low && <span className="text-destructive"> LOW: top up to resume minting</span>}
          </p>
        )}
        <p className="m-0 text-sm">Minted in last 24h: {s.daily.used} / {s.daily.cap}</p>
        <p className="m-0 text-sm">
          Queue: awaiting wallet {c.AWAITING_WALLET ?? 0} · queued {c.QUEUED ?? 0} · submitted {c.SUBMITTED ?? 0} · minted {c.MINTED ?? 0} · failed {c.FAILED ?? 0}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => act({ action: "run" }, "Run queue")}>Run queue now</button>
          <button type="button" className={btn} onClick={load}>Refresh</button>
        </div>
      </section>

      {(s.failed.length > 0 || s.stuck.length > 0) && (
        <section className="grid gap-2">
          <h2 className="text-xl font-black m-0">Needs attention</h2>
          {s.failed.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 pt-2 text-sm">
              <span>Failed: call #{f.callId}, member {f.discordId}, {f.attempts} attempts. {f.lastError ?? ""}</span>
              <button type="button" className={btn} onClick={() => act({ action: "retry", claimId: f.id }, "Retry")}>Retry</button>
            </div>
          ))}
          {s.stuck.map((x) => (
            <div key={x.id} className="border-t border-foreground/10 pt-2 text-sm">Stuck over 10 min: call #{x.callId} {x.txHash}. The next queue run reconciles it.</div>
          ))}
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="text-xl font-black m-0">Crew template art</h2>
        <p className="m-0 text-sm text-foreground/70">Square PNG or JPEG (1000x1000 ideal). The crew name, date and slice number are stamped on automatically. Crews without art use the default pizza template.</p>
        {s.crews.map((cr) => (
          <div key={cr.id} className="flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-2">
            {cr.artUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cr.artUrl} alt="" width={48} height={48} className="rounded" />
            ) : <span className="w-12 h-12 rounded bg-foreground/10 flex items-center justify-center text-xs">default</span>}
            <span className="min-w-40 text-sm">{cr.label} <span className="text-foreground/50">({cr.id})</span></span>
            <label className={`${btn} inline-flex items-center`}>
              {cr.artUrl ? "Replace" : "Upload"}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { void upload(cr.id, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {cr.artUrl && <button type="button" className={btn} onClick={() => removeArt(cr.id)}>Remove</button>}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <h2 className="text-xl font-black m-0">Recent calls (token ids)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-foreground/60"><th className="p-2">#</th><th className="p-2">Crew</th><th className="p-2">Day</th><th className="p-2">Claims</th><th className="p-2">Image</th></tr></thead>
          <tbody>
            {s.calls.map((cl) => (
              <tr key={cl.id} className="border-t border-foreground/10">
                <td className="p-2">{cl.id}</td><td className="p-2">{cl.crewLabel}</td><td className="p-2">{cl.callDay}</td><td className="p-2">{cl.claims}</td>
                <td className="p-2">
                  <button type="button" className={btn} onClick={() => act({ action: "rerender", callId: cl.id }, `Re-render #${cl.id}`)}>{cl.imageUrl ? "Re-render" : "Render"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
