"use client";

import { useCallback, useEffect, useState } from "react";

type Kind = "background" | "frame" | "accessory" | "badge";
type RuleKind = "level" | "role" | "mission" | "item" | "everyone";
interface Rule { kind: RuleKind; params: Record<string, unknown> }
interface Asset {
  id: number; slug: string; name: string; kind: Kind; imageUrl: string; lockedHint: string | null;
  isActive: boolean; sortOrder: number; rules: Rule[];
}
interface Options {
  levels: { level: number; title: string | null }[];
  missions: { id: number; level: number; title: string }[];
  items: { id: number; name: string }[];
  roles: { id: string; name: string }[] | null;
}
interface Grant { assetId: number; discordId: string; createdAt: string }
interface Event { id: number; action: string; assetName: string; targetId: string | null; actorId: string; createdAt: string }

const KINDS: Kind[] = ["background", "frame", "accessory", "badge"];
const SAMPLE_PFP = "/pfp/default.jpg";

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function RulesEditor({ rules, options, onChange }: { rules: Rule[]; options: Options; onChange: (r: Rule[]) => void }) {
  const set = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  return (
    <div className="grid gap-2">
      {rules.length === 0 && <p className="m-0 text-sm text-foreground/60">No rules: only manual grants unlock this.</p>}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border px-2 py-1 bg-background"
            value={r.kind}
            onChange={(e) => set(i, { kind: e.target.value as RuleKind, params: {} })}
            aria-label="Rule type"
          >
            <option value="level">Reach level</option>
            <option value="role">Has Discord role</option>
            <option value="mission">Completed mission</option>
            <option value="item">Owns item</option>
            <option value="everyone">Everyone</option>
          </select>
          {r.kind === "level" && (
            <select className="rounded border px-2 py-1 bg-background" value={String(r.params.minLevel ?? "")}
              onChange={(e) => set(i, { ...r, params: { minLevel: Number(e.target.value) } })} aria-label="Minimum level">
              <option value="">Pick a level</option>
              {options.levels.map((l) => (
                <option key={l.level} value={l.level}>Level {l.level}{l.title ? ` - ${l.title}` : ""} and up</option>
              ))}
            </select>
          )}
          {r.kind === "role" && (
            options.roles ? (
              <select className="rounded border px-2 py-1 bg-background" value={String(r.params.roleId ?? "")}
                onChange={(e) => set(i, { ...r, params: { roleId: e.target.value } })} aria-label="Discord role">
                <option value="">Pick a role</option>
                {options.roles.map((ro) => <option key={ro.id} value={ro.id}>{ro.name}</option>)}
              </select>
            ) : <span className="text-sm text-foreground/60">Roles unavailable right now.</span>
          )}
          {r.kind === "mission" && (
            <select className="rounded border px-2 py-1 bg-background" value={String(r.params.missionId ?? "")}
              onChange={(e) => set(i, { ...r, params: { missionId: Number(e.target.value) } })} aria-label="Mission">
              <option value="">Pick a mission</option>
              {options.missions.map((m) => <option key={m.id} value={m.id}>L{m.level} · {m.title}</option>)}
            </select>
          )}
          {r.kind === "item" && (
            <select className="rounded border px-2 py-1 bg-background" value={String(r.params.itemId ?? "")}
              onChange={(e) => set(i, { ...r, params: { itemId: Number(e.target.value) } })} aria-label="Shop item">
              <option value="">Pick an item</option>
              {options.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
          )}
          <button type="button" className="text-sm underline" onClick={() => onChange(rules.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="justify-self-start text-sm underline" onClick={() => onChange([...rules, { kind: "level", params: {} }])}>
        Add rule
      </button>
    </div>
  );
}

function Preview({ url, kind }: { url: string; kind: Kind }) {
  return (
    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border bg-foreground/5" aria-label="Preview over a sample picture">
      {kind !== "background" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={SAMPLE_PFP} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

function AssetCard({ asset, options, grants, onSaved, onError }: {
  asset: Asset | null; options: Options; grants: Grant[]; onSaved: () => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(asset?.name ?? "");
  const [kind, setKind] = useState<Kind>(asset?.kind ?? "accessory");
  const [imageUrl, setImageUrl] = useState(asset?.imageUrl ?? "");
  const [hint, setHint] = useState(asset?.lockedHint ?? "");
  const [sortOrder, setSortOrder] = useState(asset?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(asset?.isActive ?? false);
  const [rules, setRules] = useState<Rule[]>(asset?.rules ?? []);
  const [busy, setBusy] = useState(false);
  const [grantTo, setGrantTo] = useState("");

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      const r = await api("/api/admin/pfp-assets/upload", { method: "POST", body: fd });
      setImageUrl(r.url);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      const body = { name, kind, imageUrl, lockedHint: hint || null, sortOrder, isActive, rules };
      if (asset) await api(`/api/admin/pfp-assets/${asset.id}`, jsonInit("PATCH", body));
      else {
        await api("/api/admin/pfp-assets", jsonInit("POST", body));
        setName(""); setImageUrl(""); setHint(""); setRules([]); setIsActive(false);
      }
      onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!asset || !window.confirm(`Delete "${asset.name}"? Rules and grants go with it.`)) return;
    try { await api(`/api/admin/pfp-assets/${asset.id}`, jsonInit("DELETE", {})); onSaved(); } catch (e) { onError((e as Error).message); }
  }

  async function grant(revoke: boolean, id?: string) {
    if (!asset) return;
    try {
      await api("/api/admin/pfp-assets/grants", jsonInit(revoke ? "DELETE" : "POST", { assetId: asset.id, discordId: id ?? grantTo }));
      if (!revoke) setGrantTo("");
      onSaved();
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <section className="paper-soft rounded-[18px] border p-4 grid gap-3">
      <div className="flex gap-4 items-start flex-wrap">
        <Preview url={imageUrl} kind={kind} />
        <div className="grid gap-2 flex-1 min-w-[220px]">
          <label className="grid gap-1 text-sm">Name
            <input className="rounded border px-2 py-1 bg-background" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex gap-2 flex-wrap">
            <label className="grid gap-1 text-sm">Kind
              <select className="rounded border px-2 py-1 bg-background" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Sort order
              <input type="number" className="w-24 rounded border px-2 py-1 bg-background" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">Art (PNG or WebP, square, transparent except backgrounds, 5 MB max)
            <input type="file" accept="image/png,image/webp" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <label className="grid gap-1 text-sm">Locked hint (blank = generated from the rules)
            <input className="rounded border px-2 py-1 bg-background" value={hint} maxLength={120} onChange={(e) => setHint(e.target.value)} />
          </label>
        </div>
      </div>

      <div>
        <p className="m-0 mb-1 text-sm font-semibold">Unlocked when any of these match</p>
        <RulesEditor rules={rules} options={options} onChange={setRules} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (members can see it)
        </label>
        <button type="button" disabled={busy || !name || !imageUrl} onClick={save} className="rounded border px-3 py-1 font-semibold disabled:opacity-50">
          {asset ? "Save" : "Create asset"}
        </button>
        {asset && <button type="button" onClick={remove} className="text-sm underline text-tomato">Delete</button>}
      </div>

      {asset && (
        <div className="grid gap-2 border-t pt-3">
          <p className="m-0 text-sm font-semibold">Manual grants (by Discord id)</p>
          <div className="flex gap-2 flex-wrap">
            <input className="rounded border px-2 py-1 bg-background" placeholder="Discord id" value={grantTo} onChange={(e) => setGrantTo(e.target.value)} />
            <button type="button" className="rounded border px-3 py-1 text-sm" disabled={!grantTo.trim()} onClick={() => grant(false)}>Grant</button>
          </div>
          <ul className="m-0 p-0 list-none grid gap-1 text-sm">
            {grants.filter((g) => g.assetId === asset.id).map((g) => (
              <li key={g.discordId} className="flex gap-2 items-center">
                <code>{g.discordId}</code>
                <button type="button" className="underline" onClick={() => grant(true, g.discordId)}>Revoke</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PfpAssetsAdmin() {
  const [data, setData] = useState<{ assets: Asset[]; options: Options; grants: Grant[]; events: Event[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api("/api/admin/pfp-assets")); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <p className="text-foreground/60">{error ?? "Loading..."}</p>;
  return (
    <div className="grid gap-4">
      {error && <p role="alert" className="m-0 rounded border border-tomato p-2 text-sm">{error}</p>}
      <h2 className="m-0 text-xl font-bold">New asset</h2>
      <AssetCard key={`new-${data.assets.length}`} asset={null} options={data.options} grants={data.grants}
        onSaved={() => { setError(null); void load(); }} onError={setError} />
      <h2 className="m-0 text-xl font-bold">Catalog ({data.assets.length})</h2>
      {data.assets.map((a) => (
        <AssetCard key={`${a.id}-${a.rules.length}-${a.name}`} asset={a} options={data.options} grants={data.grants}
          onSaved={() => { setError(null); void load(); }} onError={setError} />
      ))}
      <h2 className="m-0 text-xl font-bold">Recent changes</h2>
      <ul className="m-0 p-0 list-none grid gap-1 text-sm text-foreground/70">
        {data.events.map((e) => (
          <li key={e.id}>{new Date(e.createdAt).toLocaleString()} · {e.action} · {e.assetName}{e.targetId ? ` · ${e.targetId}` : ""} · by {e.actorId}</li>
        ))}
        {data.events.length === 0 && <li>Nothing yet.</li>}
      </ul>
    </div>
  );
}
