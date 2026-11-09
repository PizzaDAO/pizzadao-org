"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Lock {
  id: number;
  networkId: number;
  address: string;
  name: string;
  year: number | null;
  eventSlug: string | null;
  enabled: boolean;
  source: string;
}
interface DiscoveryResult { networkId: number; chain: string; found: number; added: number; error?: string }

async function api(init?: RequestInit) {
  const res = await fetch("/api/admin/unlock-tickets", init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const PAGE = 100;

export function TicketsAdmin() {
  const [locks, setLocks] = useState<Lock[]>([]);
  const [chains, setChains] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<DiscoveryResult[] | null>(null);
  const [q, setQ] = useState("");
  const [chain, setChain] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(0);
  const [add, setAdd] = useState({ networkId: "8453", address: "", name: "", year: "" });

  const apply = (body: { locks?: Lock[]; chains?: Record<string, string> }) => {
    if (body.locks) setLocks(body.locks);
    if (body.chains) setChains(body.chains);
  };

  const load = useCallback(async () => {
    try {
      apply(await api());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return locks.filter(
      (l) =>
        (!needle || l.name.toLowerCase().includes(needle) || l.address.includes(needle)) &&
        (!chain || String(l.networkId) === chain) &&
        (!source || l.source === source) &&
        (!state || (state === "on" ? l.enabled : !l.enabled)),
    );
  }, [locks, q, chain, source, state]);
  const shown = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of locks) if (l.enabled) m[l.networkId] = (m[l.networkId] ?? 0) + 1;
    return m;
  }, [locks]);

  const setEnabled = (ids: number[], enabled: boolean) =>
    run(async () => apply(await api(send("PATCH", { ids, enabled }))));

  const input = "rounded border px-2 py-1 bg-background";

  return (
    <div className="grid gap-5">
      {msg && <p role="alert" className="m-0 rounded border border-tomato px-3 py-2 text-sm">{msg}</p>}

      <section className="grid gap-2 rounded border p-4">
        <h2 className="m-0 text-lg font-bold">Discovery</h2>
        <p className="m-0 text-sm text-foreground/70">
          Searches every chain&apos;s Unlock subgraph for locks matching the terms and adds new ones, enabled. Existing
          locks (including ones you disabled) are never changed.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-3 py-1 font-semibold disabled:opacity-50" disabled={busy}
            onClick={() => run(async () => { const b = await api(send("POST", { action: "discover" })); setResults(b.results); apply(b); })}>
            Run discovery now
          </button>
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={busy}
            onClick={() => run(async () => { const b = await api(send("POST", { action: "discover", dryRun: true })); setResults(b.results); })}>
            Preview (adds nothing)
          </button>
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={busy}
            onClick={() => run(async () => { const b = await api(send("POST", { action: "seed" })); setMsg(`${b.added} seed lock(s) added`); apply(b); })}>
            Load seed list
          </button>
        </div>
        {results && (
          <table className="text-sm">
            <thead><tr className="text-left"><th>Chain</th><th>Matching</th><th>New</th><th /></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.networkId}>
                  <td>{r.chain}</td><td>{r.found}</td><td>{r.added}</td>
                  <td className="text-tomato">{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid gap-2 rounded border p-4">
        <h2 className="m-0 text-lg font-bold">Add a lock</h2>
        <form className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { apply(await api(send("POST", { action: "add", ...add }))); setAdd({ ...add, address: "", name: "", year: "" }); });
          }}>
          <select className={input} value={add.networkId} onChange={(e) => setAdd({ ...add, networkId: e.target.value })}>
            {Object.entries(chains).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <input className={`${input} w-96 max-w-full`} placeholder="0x lock address" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <input className={input} placeholder="Name (optional)" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <input className={`${input} w-24`} placeholder="Year" inputMode="numeric" value={add.year} onChange={(e) => setAdd({ ...add, year: e.target.value })} />
          <button className="rounded border px-3 py-1 font-semibold disabled:opacity-50" disabled={busy || !add.address}>Add</button>
        </form>
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-bold">
          Locks ({locks.filter((l) => l.enabled).length} enabled of {locks.length})
        </h2>
        <p className="m-0 text-sm text-foreground/70">
          Enabled per chain: {Object.entries(counts).map(([id, n]) => `${chains[id] ?? id} ${n}`).join(", ") || "none"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} w-64`} placeholder="Filter by name or address" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <select className={input} value={chain} onChange={(e) => { setChain(e.target.value); setPage(0); }}>
            <option value="">All chains</option>
            {Object.entries(chains).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={input} value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}>
            <option value="">Any source</option>
            <option value="seed">Seed</option><option value="discovered">Discovered</option><option value="admin">Admin</option>
          </select>
          <select className={input} value={state} onChange={(e) => { setState(e.target.value); setPage(0); }}>
            <option value="">Enabled and disabled</option>
            <option value="on">Enabled</option><option value="off">Disabled</option>
          </select>
          <button className="rounded border px-2 py-1 text-sm disabled:opacity-50" disabled={busy || filtered.length === 0}
            onClick={() => confirm(`Disable all ${filtered.length} matching locks?`) && setEnabled(filtered.map((l) => l.id), false)}>
            Disable all {filtered.length} matching
          </button>
          <button className="rounded border px-2 py-1 text-sm disabled:opacity-50" disabled={busy || filtered.length === 0}
            onClick={() => confirm(`Enable all ${filtered.length} matching locks?`) && setEnabled(filtered.map((l) => l.id), true)}>
            Enable all matching
          </button>
        </div>

        {loading ? <p>Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b"><th className="py-1">On</th><th>Name</th><th>Chain</th><th>Year</th><th>Source</th><th>Address</th></tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className={`border-b ${l.enabled ? "" : "opacity-50"}`}>
                    <td className="py-1">
                      <input type="checkbox" aria-label={`Enable ${l.name}`} checked={l.enabled} disabled={busy} onChange={(e) => setEnabled([l.id], e.target.checked)} />
                    </td>
                    <td>{l.name}</td>
                    <td>{chains[l.networkId] ?? l.networkId}</td>
                    <td>{l.year ?? ""}</td>
                    <td>{l.source}</td>
                    <td className="font-mono text-xs">{l.address.slice(0, 8)}…{l.address.slice(-6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3 text-sm">
          <button className="underline disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{filtered.length === 0 ? 0 : page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} of {filtered.length}</span>
          <button className="underline disabled:opacity-40" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
    </div>
  );
}
