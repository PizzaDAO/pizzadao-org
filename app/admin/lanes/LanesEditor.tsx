"use client";

// app/admin/lanes/LanesEditor.tsx
//
// Lane fields, mission mapping, publishing and the guide steps (plans/lane-cards-mission-onboarding.md).
// The server validates everything again on save (/api/admin/lanes).

import { useCallback, useEffect, useState } from "react";

export interface LanesLabels {
    nonProdBanner: string;
    noLanes: string;
    published: string;
    draft: string;
    preview: string;
    tag: string;
    laneTitle: string;
    summary: string;
    mission: string;
    noMission: string;
    stretch: string;
    crew: string;
    publish: string;
    saveLane: string;
    saving: string;
    saved: string;
    notePlaceholder: string;
    steps: string;
    noSteps: string;
    stepTitle: string;
    stepBody: string;
    stepBodyHelp: string;
    stepLink: string;
    stepLinkLabel: string;
    stepKind: string;
    kindRead: string;
    kindDo: string;
    kindSubmit: string;
    saveStep: string;
    addStep: string;
    deleteStep: string;
    deleteConfirm: string;
    moveUp: string;
    moveDown: string;
    recent: string;
    noHistory: string;
    errorGeneric: string;
    loadError: string;
}

interface Step {
    id: string;
    position: number;
    title: string;
    body: string;
    linkHref: string | null;
    linkLabel: string | null;
    kind: string;
}
interface Lane {
    slug: string;
    tag: string;
    title: string;
    summary: string;
    missionId: number | null;
    stretchMissionIds: number[];
    crewId: string | null;
    published: boolean;
    steps: Step[];
}
interface MissionOption {
    id: number;
    title: string;
    level: number;
    isActive: boolean;
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
const input = "rounded-lg border bg-background px-2 py-1";

async function send(method: "PATCH" | "POST" | "DELETE", body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/admin/lanes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, error: typeof data.error === "string" ? data.error : undefined };
}

function useAction(labels: LanesLabels, onDone: () => void) {
    const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
    const [error, setError] = useState<string | null>(null);
    async function run(method: "PATCH" | "POST" | "DELETE", body: Record<string, unknown>) {
        setError(null);
        setState("saving");
        const r = await send(method, body);
        if (!r.ok) {
            setError(r.error ?? labels.errorGeneric);
            setState("idle");
            return;
        }
        setState("saved");
        onDone();
    }
    return { state, error, run };
}

function StepBox({ step, first, last, labels, onSaved }: { step: Step; first: boolean; last: boolean; labels: LanesLabels; onSaved: () => void }) {
    const [title, setTitle] = useState(step.title);
    const [body, setBody] = useState(step.body);
    const [href, setHref] = useState(step.linkHref ?? "");
    const [linkLabel, setLinkLabel] = useState(step.linkLabel ?? "");
    const [kind, setKind] = useState(step.kind);
    const act = useAction(labels, onSaved);

    const patch: Record<string, unknown> = {
        stepId: step.id,
        ...(title.trim() !== step.title ? { title: title.trim() } : {}),
        ...(body !== step.body ? { body } : {}),
        ...(href.trim() !== (step.linkHref ?? "") ? { linkHref: href.trim() || null } : {}),
        ...(linkLabel.trim() !== (step.linkLabel ?? "") ? { linkLabel: linkLabel.trim() || null } : {}),
        ...(kind !== step.kind ? { kind } : {}),
    };
    const dirty = Object.keys(patch).length > 1;

    return (
        <li className="grid gap-2 rounded-xl border p-3" style={border}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/50">
                <span>#{step.position}</span>
                <span className="flex gap-2">
                    <button type="button" disabled={first} onClick={() => void act.run("PATCH", { stepId: step.id, move: "up" })} className="rounded border px-2 py-0.5 disabled:opacity-30" style={border}>{labels.moveUp}</button>
                    <button type="button" disabled={last} onClick={() => void act.run("PATCH", { stepId: step.id, move: "down" })} className="rounded border px-2 py-0.5 disabled:opacity-30" style={border}>{labels.moveDown}</button>
                </span>
            </div>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.stepTitle}</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} style={border} />
            </label>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.stepBody}</span>
                <textarea value={body} maxLength={4000} rows={4} onChange={(e) => setBody(e.target.value)} className={`${input} font-mono text-xs`} style={border} />
                <span className="text-xs text-foreground/50">{labels.stepBodyHelp}</span>
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
                <label className="grid min-w-48 flex-1 gap-1">
                    <span className="text-foreground/50">{labels.stepLink}</span>
                    <input value={href} maxLength={300} onChange={(e) => setHref(e.target.value)} className={input} style={border} />
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.stepLinkLabel}</span>
                    <input value={linkLabel} maxLength={60} onChange={(e) => setLinkLabel(e.target.value)} className={input} style={border} />
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.stepKind}</span>
                    <select value={kind} onChange={(e) => setKind(e.target.value)} className={input} style={border}>
                        <option value="read">{labels.kindRead}</option>
                        <option value="do">{labels.kindDo}</option>
                        <option value="submit">{labels.kindSubmit}</option>
                    </select>
                </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" disabled={!dirty || act.state === "saving"} onClick={() => void act.run("PATCH", patch)} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {act.state === "saving" ? labels.saving : labels.saveStep}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (window.confirm(labels.deleteConfirm)) void act.run("DELETE", { stepId: step.id });
                    }}
                    className="rounded-lg border px-3 py-1.5"
                    style={border}
                >
                    {labels.deleteStep}
                </button>
                {act.state === "saved" && <span role="status" className="text-foreground/60">{labels.saved}</span>}
            </div>
            {act.error && <p role="alert" className="m-0 text-sm text-tomato">{act.error}</p>}
        </li>
    );
}

function NewStep({ slug, labels, onSaved }: { slug: string; labels: LanesLabels; onSaved: () => void }) {
    const [title, setTitle] = useState("");
    const act = useAction(labels, () => {
        setTitle("");
        onSaved();
    });
    return (
        <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="grid min-w-48 flex-1 gap-1">
                <span className="text-foreground/50">{labels.stepTitle}</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} style={border} />
            </label>
            <button type="button" disabled={!title.trim() || act.state === "saving"} onClick={() => void act.run("POST", { slug, title: title.trim(), body: "", kind: "do" })} className="rounded-lg border px-3 py-1.5 font-bold" style={border}>
                {labels.addStep}
            </button>
            {act.error && <p role="alert" className="m-0 w-full text-sm text-tomato">{act.error}</p>}
        </div>
    );
}

function LaneBox({ lane, missions, labels, onSaved }: { lane: Lane; missions: MissionOption[]; labels: LanesLabels; onSaved: () => void }) {
    const [tag, setTag] = useState(lane.tag);
    const [title, setTitle] = useState(lane.title);
    const [summary, setSummary] = useState(lane.summary);
    const [missionId, setMissionId] = useState(lane.missionId === null ? "" : String(lane.missionId));
    const [stretch, setStretch] = useState(lane.stretchMissionIds.join(", "));
    const [crew, setCrew] = useState(lane.crewId ?? "");
    const [published, setPublished] = useState(lane.published);
    const [note, setNote] = useState("");
    const act = useAction(labels, onSaved);

    const stretchIds = stretch.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    const patch: Record<string, unknown> = {
        slug: lane.slug,
        ...(tag.trim() !== lane.tag ? { tag: tag.trim() } : {}),
        ...(title.trim() !== lane.title ? { title: title.trim() } : {}),
        ...(summary.trim() !== lane.summary ? { summary: summary.trim() } : {}),
        ...((missionId === "" ? null : Number(missionId)) !== lane.missionId ? { missionId: missionId === "" ? null : Number(missionId) } : {}),
        ...(stretchIds.join(",") !== lane.stretchMissionIds.join(",") ? { stretchMissionIds: stretchIds } : {}),
        ...(crew.trim() !== (lane.crewId ?? "") ? { crewId: crew.trim() || null } : {}),
        ...(published !== lane.published ? { published } : {}),
        note,
    };
    const dirty = Object.keys(patch).some((k) => k !== "slug" && k !== "note");

    return (
        <section className="grid gap-3 rounded-2xl border p-4" style={border}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 font-[family-name:var(--font-display)] text-xl font-black">{lane.tag} <span className="text-sm font-normal text-foreground/50">/{lane.slug}</span></h2>
                <span className="flex items-center gap-3 text-sm">
                    <span className={lane.published ? "font-bold text-foreground" : "text-foreground/50"}>{lane.published ? labels.published : labels.draft}</span>
                    <a href={`/lanes/${lane.slug}`} className="underline">{labels.preview}</a>
                </span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.tag}</span>
                    <input value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} className={`${input} w-32`} style={border} />
                </label>
                <label className="grid min-w-48 flex-1 gap-1">
                    <span className="text-foreground/50">{labels.laneTitle}</span>
                    <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className={input} style={border} />
                </label>
            </div>
            <label className="grid gap-1 text-sm">
                <span className="text-foreground/50">{labels.summary}</span>
                <textarea value={summary} maxLength={280} rows={2} onChange={(e) => setSummary(e.target.value)} className={input} style={border} />
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
                <label className="grid min-w-48 flex-1 gap-1">
                    <span className="text-foreground/50">{labels.mission}</span>
                    <select value={missionId} onChange={(e) => setMissionId(e.target.value)} className={input} style={border}>
                        <option value="">{labels.noMission}</option>
                        {missions.map((m) => (
                            <option key={m.id} value={m.id}>
                                #{m.id} L{m.level} {m.title}{m.isActive ? "" : " (inactive)"}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.stretch}</span>
                    <input value={stretch} onChange={(e) => setStretch(e.target.value)} className={`${input} w-40`} style={border} />
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/50">{labels.crew}</span>
                    <input value={crew} maxLength={40} onChange={(e) => setCrew(e.target.value)} className={`${input} w-32`} style={border} />
                </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
                {labels.publish}
            </label>
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={labels.notePlaceholder} aria-label={labels.notePlaceholder} className={`${input} min-w-40 flex-1`} style={border} />
                <button type="button" disabled={!dirty || act.state === "saving"} onClick={() => void act.run("PATCH", patch)} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {act.state === "saving" ? labels.saving : labels.saveLane}
                </button>
                {act.state === "saved" && <span role="status" className="text-foreground/60">{labels.saved}</span>}
            </div>
            {act.error && <p role="alert" className="m-0 text-sm text-tomato">{act.error}</p>}

            <h3 className="m-0 font-[family-name:var(--font-display)] text-lg font-black">{labels.steps}</h3>
            {lane.steps.length === 0 && <p className="m-0 text-sm text-foreground/60">{labels.noSteps}</p>}
            <ul className="m-0 grid list-none gap-3 p-0">
                {lane.steps.map((s, i) => (
                    <StepBox key={`${s.id}:${JSON.stringify([s.position, s.title, s.body, s.linkHref, s.linkLabel, s.kind])}`} step={s} first={i === 0} last={i === lane.steps.length - 1} labels={labels} onSaved={onSaved} />
                ))}
            </ul>
            <NewStep slug={lane.slug} labels={labels} onSaved={onSaved} />
        </section>
    );
}

export function LanesEditor({ labels }: { labels: LanesLabels }) {
    const [lanes, setLanes] = useState<Lane[] | null>(null);
    const [missions, setMissions] = useState<MissionOption[]>([]);
    const [changes, setChanges] = useState<Change[]>([]);
    const [nonProd, setNonProd] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/lanes", { cache: "no-store" });
        if (!res.ok) return setFailed(true);
        const data = (await res.json()) as { lanes: Lane[]; missions: MissionOption[]; changes: Change[]; nonProduction?: boolean };
        setFailed(false);
        setLanes(data.lanes);
        setMissions(data.missions);
        setChanges(data.changes);
        setNonProd(data.nonProduction === true);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (failed) return <p role="alert" className="text-tomato">{labels.loadError}</p>;
    if (!lanes) return null;

    return (
        <div className="grid gap-6">
            {nonProd && <p role="alert" className="m-0 rounded-xl border border-tomato bg-tomato/10 p-3 text-sm font-bold">{labels.nonProdBanner}</p>}
            {lanes.length === 0 && <p className="m-0 text-foreground/60">{labels.noLanes}</p>}
            {lanes.map((l) => (
                <LaneBox key={`${l.slug}:${JSON.stringify([l.tag, l.title, l.summary, l.missionId, l.stretchMissionIds, l.crewId, l.published])}`} lane={l} missions={missions} labels={labels} onSaved={load} />
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
