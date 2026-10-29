"use client";

// app/admin/missions/MissionsEditor.tsx
//
// Per-level reward/title and per-mission title, description, active flag and verifier params.
// Params are JSON, with a number input for each numeric key (vouch counts etc.) that edits the
// JSON. The server runs each verifier's own parse() and re-validates everything on save.

import { useCallback, useEffect, useState } from "react";

export interface MissionsLabels {
    nonProdBanner: string;
    level: string;
    levelTitle: string;
    reward: string;
    rewardsDisagree: string;
    saveLevel: string;
    missionTitle: string;
    missionDescription: string;
    guideLink: string;
    guideLinkHelp: string;
    active: string;
    verifier: string;
    manualVerifier: string;
    params: string;
    paramsHelp: string;
    rewardLowerOnly: string;
    activeOnlyEnable: string;
    saveMission: string;
    saving: string;
    saved: string;
    notePlaceholder: string;
    confirmTitle: string;
    confirmYes: string;
    confirmNo: string;
    recent: string;
    noHistory: string;
    errorGeneric: string;
    loadError: string;
}

interface AdminMission {
    id: number;
    level: number;
    index: number;
    title: string;
    description: string | null;
    isActive: boolean;
    verifierKey: string | null;
    verifierParams: unknown;
    codeParams: Record<string, unknown> | null;
    proofKind: string;
    guideHref: string | null;
}
interface AdminLevel {
    level: number;
    levelTitle: string | null;
    reward: number | null;
    rewardsDisagree: boolean;
    rewardCeiling: number | null;
    missions: AdminMission[];
}
interface Change {
    id: number;
    key: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    changedAt: string;
    note: string | null;
}

const border = { borderColor: "hsl(var(--rule-warm) / 0.55)" };
const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

async function patch(body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const res = await fetch("/api/admin/missions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Save with the shared confirm step: the first try without `confirm`, then again after "Yes". */
function useSaver(labels: MissionsLabels, onSaved: () => void) {
    const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<{ text: string; body: Record<string, unknown> } | null>(null);

    async function run(body: Record<string, unknown>, confirm = false) {
        setError(null);
        setState("saving");
        const r = await patch({ ...body, confirm });
        if (r.status === 409 && typeof r.data.needsConfirm === "string") {
            setPending({ text: r.data.needsConfirm, body });
            setState("idle");
            return;
        }
        if (!r.ok) {
            setError(typeof r.data.error === "string" ? r.data.error : labels.errorGeneric);
            setState("idle");
            return;
        }
        setPending(null);
        setState("saved");
        onSaved();
    }
    return { state, error, pending, run, cancel: () => setPending(null) };
}

function ConfirmBox({ labels, text, onYes, onNo }: { labels: MissionsLabels; text: string; onYes: () => void; onNo: () => void }) {
    return (
        <div role="alertdialog" aria-label={labels.confirmTitle} className="grid gap-2 rounded-xl border border-tomato p-3 text-sm">
            <strong>{labels.confirmTitle}</strong>
            <span>{text}</span>
            <span className="flex gap-2">
                <button type="button" onClick={onYes} className="rounded-lg bg-tomato px-3 py-1 font-bold text-white">{labels.confirmYes}</button>
                <button type="button" onClick={onNo} className="rounded-lg border px-3 py-1" style={border}>{labels.confirmNo}</button>
            </span>
        </div>
    );
}

function LevelBox({ lvl, labels, onSaved }: { lvl: AdminLevel; labels: MissionsLabels; onSaved: () => void }) {
    const [reward, setReward] = useState(lvl.reward === null ? "" : String(lvl.reward));
    const [title, setTitle] = useState(lvl.levelTitle ?? "");
    const [note, setNote] = useState("");
    const saver = useSaver(labels, onSaved);

    const body = {
        level: lvl.level,
        ...(reward.trim() !== "" && Number(reward) !== lvl.reward ? { reward: Number(reward) } : {}),
        ...(title.trim() !== (lvl.levelTitle ?? "") ? { levelTitle: title.trim() || null } : {}),
        note,
    };
    const dirty = "reward" in body || "levelTitle" in body;

    return (
        <div className="grid gap-2">
            <div className="flex flex-wrap items-end gap-3 text-sm">
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.levelTitle}</span>
                    <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border bg-background px-2 py-1" style={border} />
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.reward}</span>
                    <input type="number" min={1} max={lvl.rewardCeiling ?? lvl.reward ?? 1000000} value={reward} onChange={(e) => setReward(e.target.value)} className="w-32 rounded-lg border bg-background px-2 py-1 tabular-nums" style={border} />
                </label>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={labels.notePlaceholder} aria-label={labels.notePlaceholder} className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1" style={border} />
                <button type="button" disabled={!dirty || saver.state === "saving"} onClick={() => saver.run(body)} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {saver.state === "saving" ? labels.saving : labels.saveLevel}
                </button>
                {saver.state === "saved" && <span role="status" className="text-foreground/60">{labels.saved}</span>}
            </div>
            <p className="m-0 text-xs text-foreground/50">{labels.rewardLowerOnly}</p>
            {lvl.rewardsDisagree && <p role="alert" className="m-0 text-sm text-tomato">{labels.rewardsDisagree}</p>}
            {saver.pending && <ConfirmBox labels={labels} text={saver.pending.text} onYes={() => saver.run(saver.pending!.body, true)} onNo={saver.cancel} />}
            {saver.error && <p role="alert" className="m-0 text-sm text-tomato">{saver.error}</p>}
        </div>
    );
}

const prettyParams = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

function MissionBox({ m, labels, onSaved }: { m: AdminMission; labels: MissionsLabels; onSaved: () => void }) {
    const [title, setTitle] = useState(m.title);
    const [description, setDescription] = useState(m.description ?? "");
    const [guideHref, setGuideHref] = useState(m.guideHref ?? "");
    const [active, setActive] = useState(m.isActive);
      const [note, setNote] = useState("");
    const saver = useSaver(labels, onSaved);

    // Only raising a numeric minimum is editable; everything else is shown read-only.
    const current = (m.verifierParams && typeof m.verifierParams === "object" && !Array.isArray(m.verifierParams) ? m.verifierParams : {}) as Record<string, unknown>;
    const minKeys = Object.entries(current).filter(([k, v]) => /^min(?!Level$)([A-Z]\w*)?$/.test(k) && typeof v === "number") as Array<[string, number]>;
    // A minimum may move anywhere at or above the code value (so a typo can be undone).
    const floorOf = (k: string, v: number) => {
        const c = m.codeParams?.[k];
        return typeof c === "number" ? Math.min(c, v) : v;
    };
    const [edited, setEdited] = useState<Record<string, string>>({});
    const changedParams: Record<string, number> = {};
    for (const [k, v] of minKeys) {
        const n = Number(edited[k]);
        if (edited[k] !== undefined && edited[k] !== "" && Number.isFinite(n) && n !== v && n >= floorOf(k, v)) changedParams[k] = n;
    }
    const paramsChanged = Object.keys(changedParams).length > 0;

    const body: Record<string, unknown> = {
        missionId: m.id,
        ...(title.trim() !== m.title ? { title: title.trim() } : {}),
        ...(description.trim() !== (m.description ?? "") ? { description: description.trim() || null } : {}),
        ...(guideHref.trim() !== (m.guideHref ?? "") ? { guideHref: guideHref.trim() || null } : {}),
        ...(active !== m.isActive ? { isActive: active } : {}),
        ...(paramsChanged ? { verifierParams: { ...current, ...changedParams } } : {}),
        note,
    };
    const dirty = Object.keys(body).some((k) => k !== "missionId" && k !== "note");

    return (
        <li className="grid gap-2 rounded-xl border p-3" style={border}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground/50">
                <span>L{m.level}.{m.index} #{m.id}</span>
                <span>{labels.verifier}: {m.verifierKey ?? labels.manualVerifier}</span>
            </div>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.missionTitle}</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border bg-background px-2 py-1" style={border} />
            </label>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.missionDescription}</span>
                <textarea value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} className="rounded-lg border bg-background px-2 py-1" style={border} />
            </label>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.guideLink}</span>
                <input value={guideHref} maxLength={120} placeholder="/handbook/levels#vouching" onChange={(e) => setGuideHref(e.target.value)} className="rounded-lg border bg-background px-2 py-1" style={border} />
                <span className="text-xs text-foreground/50">{labels.guideLinkHelp}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} disabled={m.isActive} onChange={(e) => setActive(e.target.checked)} />
                {labels.active}{m.isActive ? <span className="text-xs text-foreground/50"> ({labels.activeOnlyEnable})</span> : null}
            </label>
            {m.verifierKey && (
                <div className="grid gap-1 text-sm">
                    <span className="text-foreground/50">{labels.params}</span>
                    {minKeys.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                            {minKeys.map(([k, v]) => (
                                <label key={k} className="grid gap-1">
                                    <span className="text-xs text-foreground/50">{k}</span>
                                    <input type="number" min={floorOf(k, v)} placeholder={String(v)} value={edited[k] ?? ""} onChange={(e) => setEdited({ ...edited, [k]: e.target.value })} className="w-24 rounded-lg border bg-background px-2 py-1 tabular-nums" style={border} />
                                </label>
                            ))}
                        </div>
                    )}
                    <pre className="m-0 overflow-x-auto rounded-lg border bg-background px-2 py-1 font-mono text-xs" style={border}>{prettyParams(m.verifierParams)}</pre>
                    <span className="text-xs text-foreground/50">{labels.paramsHelp}</span>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={labels.notePlaceholder} aria-label={labels.notePlaceholder} className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1" style={border} />
                <button type="button" disabled={!dirty || saver.state === "saving"} onClick={() => saver.run(body)} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {saver.state === "saving" ? labels.saving : labels.saveMission}
                </button>
                {saver.state === "saved" && <span role="status" className="text-foreground/60">{labels.saved}</span>}
            </div>
            {saver.pending && <ConfirmBox labels={labels} text={saver.pending.text} onYes={() => saver.run(saver.pending!.body, true)} onNo={saver.cancel} />}
            {saver.error && <p role="alert" className="m-0 text-sm text-tomato">{saver.error}</p>}
        </li>
    );
}

export function MissionsEditor({ labels }: { labels: MissionsLabels }) {
    const [levels, setLevels] = useState<AdminLevel[] | null>(null);
    const [changes, setChanges] = useState<Change[]>([]);
    const [nonProd, setNonProd] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/missions", { cache: "no-store" });
        if (!res.ok) return setFailed(true);
        const data = (await res.json()) as { levels: AdminLevel[]; changes: Change[]; nonProduction?: boolean };
        setFailed(false);
        setLevels(data.levels);
        setChanges(data.changes);
        setNonProd(data.nonProduction === true);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (failed) return <p role="alert" className="text-tomato">{labels.loadError}</p>;
    if (!levels) return null;

    return (
        <div className="grid gap-6">
            {nonProd && <p role="alert" className="m-0 rounded-xl border border-tomato bg-tomato/10 p-3 text-sm font-bold">{labels.nonProdBanner}</p>}
            {levels.map((lvl) => (
                <section key={lvl.level} className="grid gap-3 rounded-2xl border p-4" style={border}>
                    <h2 className="m-0 font-[family-name:var(--font-display)] text-xl font-black">{fill(labels.level, { level: String(lvl.level) })}</h2>
                    <LevelBox key={`${lvl.reward}:${lvl.levelTitle}`} lvl={lvl} labels={labels} onSaved={load} />
                    <ul className="m-0 grid list-none gap-3 p-0">
                        {lvl.missions.map((m) => (
                            <MissionBox key={`${m.id}:${JSON.stringify([m.title, m.description, m.guideHref, m.isActive, m.verifierParams])}`} m={m} labels={labels} onSaved={load} />
                        ))}
                    </ul>
                </section>
            ))}
            <section className="grid gap-2">
                <h2 className="m-0 font-[family-name:var(--font-display)] text-xl font-black">{labels.recent}</h2>
                {changes.length === 0 ? (
                    <p className="m-0 text-sm text-foreground/60">{labels.noHistory}</p>
                ) : (
                    <ul className="m-0 grid list-none gap-1 p-0 text-sm text-foreground/70">
                        {changes.map((c) => (
                            <li key={c.id}>
                                <code>{c.key}</code>: {JSON.stringify(c.oldValue)} {"->"} {JSON.stringify(c.newValue)} ({c.changedBy}, {new Date(c.changedAt).toLocaleString()})
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
