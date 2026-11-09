"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Kind = "background" | "outfit" | "frame" | "accessory" | "badge";
type BaseKind = "static" | "discord" | "upload" | "mafia" | "restyle";
type OriginalBase = { kind: Exclude<BaseKind, "restyle">; url?: string | null };
interface Asset {
  id: number; name: string; kind: Kind; imageUrl: string; thumbUrl: string | null;
  defaultTransform: { x: number; y: number; scale: number; rotation: number } | null;
  unlocked: boolean; hint: string | null;
}
interface State {
  level: number;
  bases: { static: string | null; discord: string | null; mafia: string | null };
  current: { baseKind: BaseKind; baseUrl: string; composedUrl: string; layers: Layer[]; original: OriginalBase | null } | null;
  assets: Asset[];
  outfitOverlay: boolean;
  restyle: { enabled: boolean; perUnlock: number; dailyRemaining: number; blocked: string | null; usedByOutfit: Record<string, number> };
}
interface Layer { assetId: number; x: number; y: number; scale: number; rotation: number }

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "background", label: "Backgrounds" },
  { kind: "outfit", label: "Outfits" },
  { kind: "frame", label: "Frames" },
  { kind: "accessory", label: "Accessories (up to 3)" },
  { kind: "badge", label: "Badges" },
];
const LIMIT: Record<Kind, number> = { background: 1, outfit: 1, frame: 1, accessory: 3, badge: 1 };
const FULL: Omit<Layer, "assetId"> = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export function PfpComposer({ memberId }: { memberId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseKind, setBaseKind] = useState<BaseKind>("static");
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"layers" | "dress">("layers");
  const [restyleUrl, setRestyleUrl] = useState<string | null>(null);
  const [original, setOriginal] = useState<OriginalBase | null>(null);
  const [candidate, setCandidate] = useState<{ url: string; from: OriginalBase; outfitId: number } | null>(null);
  const [generating, setGenerating] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const s: State = await api("/api/pfp/compose");
      setState(s);
      if (s.current) {
        setBaseKind(s.current.baseKind);
        if (s.current.baseKind === "upload") setUploadUrl(s.current.baseUrl);
        if (s.current.baseKind === "restyle") {
          setRestyleUrl(s.current.baseUrl);
          setOriginal(s.current.original);
        }
        setLayers(s.current.layers);
        setSavedUrl(s.current.composedUrl);
      } else setBaseKind(s.bases.static ? "static" : s.bases.discord ? "discord" : "static");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!state) return <p className="text-foreground/60">{error ?? "Loading..."}</p>;

  const byId = new Map(state.assets.map((a) => [a.id, a]));
  const baseSrc = baseKind === "upload" ? uploadUrl : baseKind === "restyle" ? restyleUrl : state.bases[baseKind];
  // The picture a dress-up starts from: the original under a current dress-up, else the chosen base.
  const startBase: OriginalBase | null = baseKind === "restyle" ? original : { kind: baseKind, url: baseKind === "upload" ? uploadUrl : undefined };
  const startSrc = !startBase ? null : startBase.kind === "upload" ? startBase.url ?? null : state.bases[startBase.kind];
  const used = (kind: Kind) => layers.filter((l) => byId.get(l.assetId)?.kind === kind);

  function toggle(a: Asset) {
    if (!a.unlocked) return;
    setLayers((cur) => {
      if (cur.some((l) => l.assetId === a.id)) return cur.filter((l) => l.assetId !== a.id);
      const same = cur.filter((l) => byId.get(l.assetId)?.kind === a.kind);
      const rest = same.length >= LIMIT[a.kind] ? cur.filter((l) => l !== same[0]) : cur;
      return [...rest, { assetId: a.id, ...(movable(a.kind) ? { ...FULL, ...(a.defaultTransform ?? {}) } : FULL) }];
    });
    if (movable(a.kind)) setSelected(a.id);
  }

  function patch(id: number, p: Partial<Layer>) {
    setLayers((cur) => cur.map((l) => (l.assetId === id ? { ...l, ...p } : l)));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag.current === null || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    patch(drag.current, {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  }

  async function uploadBase(file: File) {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await api("/api/pfp/compose/upload", { method: "POST", body: fd });
      setUploadUrl(r.url); pickBase("upload");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await api("/api/pfp/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          base: { kind: baseKind, url: baseKind === "upload" ? uploadUrl : baseKind === "restyle" ? restyleUrl : undefined },
          ...(baseKind === "restyle" ? { original } : {}),
          layers,
        }),
      });
      setSavedUrl(r.composedUrl);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function pickBase(k: Exclude<BaseKind, "restyle">) {
    setBaseKind(k); setRestyleUrl(null); setOriginal(null); setCandidate(null);
  }

  async function dressUp(outfitId: number) {
    if (!startBase) return;
    setGenerating(outfitId); setError(null); setCandidate(null);
    try {
      const r = await api("/api/pfp/restyle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outfitId, base: { kind: startBase.kind, url: startBase.url ?? undefined } }),
      });
      setCandidate({ url: r.url, from: startBase, outfitId });
      setState((cur) => cur && {
        ...cur,
        restyle: { ...cur.restyle, dailyRemaining: r.dailyRemaining, usedByOutfit: { ...cur.restyle.usedByOutfit, [outfitId]: cur.restyle.perUnlock - r.outfitRemaining } },
      });
    } catch (e) { setError((e as Error).message); } finally { setGenerating(null); }
  }

  function useCandidate() {
    if (!candidate) return;
    setRestyleUrl(candidate.url); setOriginal(candidate.from); setBaseKind("restyle"); setCandidate(null);
  }

  function undoDressUp() {
    if (!original) return;
    setBaseKind(original.kind);
    if (original.kind === "upload") setUploadUrl(original.url ?? null);
    setRestyleUrl(null); setOriginal(null); setCandidate(null);
  }

  async function reset() {
    if (!window.confirm("Go back to your original picture?")) return;
    setBusy(true); setError(null);
    try { await api("/api/pfp/compose", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }); setLayers([]); setSavedUrl(null); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function download() {
    if (!savedUrl) return;
    try {
      const blob = await (await fetch(savedUrl)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pizzadao-pfp-${memberId}.webp`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { setError("Could not download the picture."); }
  }

  const ordered = [...layers].sort((a, b) => order(byId.get(a.assetId)?.kind) - order(byId.get(b.assetId)?.kind));
  const sel = layers.find((l) => l.assetId === selected && movable(byId.get(l.assetId)?.kind));

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="grid gap-3 content-start">
        {/* Preview: background, base, accessories, frame, badge. Drag an outfit or accessory to move it. */}
        <div
          ref={stage}
          className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-[24px] border bg-foreground/5 touch-none"
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}
        >
          {ordered.filter((l) => byId.get(l.assetId)?.kind === "background").map((l) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.assetId} src={byId.get(l.assetId)!.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {baseSrc && <img src={baseSrc} alt="Your picture" className="absolute inset-0 h-full w-full object-cover" />}
          {ordered.filter((l) => byId.get(l.assetId)?.kind !== "background").map((l) => {
            const a = byId.get(l.assetId)!;
            if (!movable(a.kind)) {
              // eslint-disable-next-line @next/next/no-img-element
              return <img key={l.assetId} src={a.imageUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />;
            }
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={l.assetId}
                src={a.imageUrl}
                alt={a.name}
                draggable={false}
                onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = l.assetId; setSelected(l.assetId); }}
                className="absolute cursor-grab select-none"
                style={{
                  left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.scale * 100}%`, height: `${l.scale * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
                  outline: l.assetId === selected ? "2px dashed hsl(var(--tomato))" : undefined,
                }}
              />
            );
          })}
        </div>

        {sel && (
          <div className="grid gap-2 text-sm">
            <label className="grid gap-1">Size
              <input type="range" min={0.2} max={2} step={0.02} value={sel.scale} onChange={(e) => patch(sel.assetId, { scale: Number(e.target.value) })} />
            </label>
            <label className="grid gap-1">Rotate
              <input type="range" min={-180} max={180} step={1} value={sel.rotation} onChange={(e) => patch(sel.assetId, { rotation: Number(e.target.value) })} />
            </label>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button type="button" disabled={busy || !baseSrc} onClick={save} className="rounded border px-4 py-2 font-semibold disabled:opacity-50">
            {busy ? "Working..." : "Save"}
          </button>
          <button type="button" disabled={!savedUrl} onClick={download} className="rounded border px-4 py-2 disabled:opacity-50">Download</button>
          {state.current && <button type="button" disabled={busy} onClick={reset} className="px-2 py-2 text-sm underline">Reset</button>}
        </div>
        {savedUrl && <p className="m-0 text-sm text-foreground/70">Saved. It shows across PizzaDAO. Download to use it on Discord, X or Telegram.</p>}
        {error && <p role="alert" className="m-0 rounded border border-tomato p-2 text-sm">{error}</p>}
      </div>

      <div className="grid gap-4 content-start">
        <section className="grid gap-2">
          <h2 className="m-0 text-lg font-bold">Base picture</h2>
          <div className="flex gap-2 flex-wrap">
            {([["static", "Current"], ["discord", "Discord"], ["mafia", "Mafia portrait"]] as const).map(([k, label]) => (
              <button key={k} type="button" disabled={!state.bases[k]} onClick={() => pickBase(k)}
                aria-pressed={baseKind === k} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${baseKind === k ? "font-bold border-foreground" : ""}`}>
                {label}
              </button>
            ))}
            <label className="rounded border px-3 py-1 text-sm cursor-pointer">
              Upload
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={busy}
                onChange={(e) => e.target.files?.[0] && uploadBase(e.target.files[0])} />
            </label>
          </div>
        </section>

        <div role="tablist" className="flex gap-2">
          {([["layers", "Layers"], ["dress", "Dress up"]] as const).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded border px-3 py-1 text-sm ${tab === t ? "font-bold border-foreground" : ""}`}>{label}</button>
          ))}
        </div>

        {tab === "dress" && (
          <section className="grid gap-3">
            <h2 className="m-0 text-lg font-bold">Dress up</h2>
            {!state.restyle.enabled ? (
              <p className="m-0 text-foreground/60">Dress up is not available yet. Check back soon.</p>
            ) : (
              <>
                <p className="m-0 text-sm text-foreground/70">
                  Redraws your picture wearing an outfit you have unlocked. {state.restyle.dailyRemaining} {state.restyle.dailyRemaining === 1 ? "try" : "tries"} left today.
                  {state.restyle.blocked ? ` ${state.restyle.blocked}` : ""}
                </p>
                {generating !== null && <p role="status" className="m-0 text-sm">Dressing you up... this takes about a minute.</p>}
                <ul className="m-0 p-0 list-none grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {state.assets.filter((a) => a.kind === "outfit").map((a) => {
                    const left = Math.max(0, state.restyle.perUnlock - (state.restyle.usedByOutfit[a.id] ?? 0));
                    const can = a.unlocked && left > 0 && state.restyle.dailyRemaining > 0 && !state.restyle.blocked && generating === null && !!startBase;
                    return (
                      <li key={a.id}>
                        <button type="button" disabled={!can} onClick={() => dressUp(a.id)} title={a.unlocked ? a.name : a.hint ?? "Locked"}
                          className={`w-full rounded-lg border p-1 text-left ${a.unlocked ? "" : "opacity-45 cursor-not-allowed"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.thumbUrl ?? a.imageUrl} alt="" className={`aspect-square w-full rounded object-contain bg-foreground/5 ${a.unlocked ? "" : "grayscale"}`} />
                          <span className="block truncate text-xs mt-1">{a.name}</span>
                          <span className="block text-[11px] leading-tight text-foreground/70">
                            {a.unlocked ? `${left} ${left === 1 ? "try" : "tries"} left` : a.hint}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {candidate && (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <figure className="m-0 grid gap-1 text-xs text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {startSrc && <img src={startSrc} alt="Before" className="aspect-square w-full rounded-lg object-cover" />}
                        Before
                      </figure>
                      <figure className="m-0 grid gap-1 text-xs text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={candidate.url} alt="After" className="aspect-square w-full rounded-lg object-cover" />
                        After
                      </figure>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={useCandidate} className="rounded border px-4 py-2 font-semibold">Use this</button>
                      <button type="button" onClick={() => setCandidate(null)} className="px-2 py-2 text-sm underline">Discard</button>
                    </div>
                  </div>
                )}
                {baseKind === "restyle" && (
                  <button type="button" onClick={undoDressUp} className="justify-self-start rounded border px-3 py-1 text-sm">Undo dress up</button>
                )}
                <p className="m-0 text-xs text-foreground/60">Press Save to keep it. Frames, accessories and badges are added on top.</p>
              </>
            )}
          </section>
        )}

        {tab === "layers" && KINDS.filter((k) => k.kind !== "outfit" || state.outfitOverlay).map(({ kind, label }) => {
          const list = state.assets.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className="grid gap-2">
              <h2 className="m-0 text-lg font-bold">{label} <span className="text-sm font-normal text-foreground/50">{used(kind).length}/{LIMIT[kind]}</span></h2>
              <ul className="m-0 p-0 list-none grid grid-cols-3 sm:grid-cols-4 gap-2">
                {list.map((a) => {
                  const on = layers.some((l) => l.assetId === a.id);
                  return (
                    <li key={a.id}>
                      <button type="button" disabled={!a.unlocked} onClick={() => toggle(a)} aria-pressed={on}
                        title={a.unlocked ? a.name : a.hint ?? "Locked"}
                        className={`w-full rounded-lg border p-1 text-left ${on ? "border-foreground ring-2 ring-foreground/40" : ""} ${a.unlocked ? "" : "opacity-45 cursor-not-allowed"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.thumbUrl ?? a.imageUrl} alt="" className={`aspect-square w-full rounded object-cover bg-foreground/5 ${a.unlocked ? "" : "grayscale"}`} />
                        <span className="block truncate text-xs mt-1">{a.name}</span>
                        {!a.unlocked && <span className="block text-[11px] leading-tight text-foreground/70">{a.hint}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {state.assets.length === 0 && <p className="m-0 text-foreground/60">Nothing to unlock yet. Check back soon.</p>}
      </div>
    </div>
  );
}

function movable(kind: Kind | undefined): boolean {
  return kind === "accessory" || kind === "outfit";
}

function order(kind: Kind | undefined): number {
  return ["background", "outfit", "accessory", "frame", "badge"].indexOf(kind ?? "accessory");
}
