"use client";

// app/admin/settings/SettingsEditor.tsx
//
// Grouped list of admin settings: code default next to the current value, validated edit with a
// confirm step when the registry asks for one, reset to default, and history. All data comes from
// the DPR-gated /api/admin/settings route; the server re-validates every write.

import { useCallback, useEffect, useState } from "react";

export interface SettingsLabels {
    codeDefault: string;
    current: string;
    modified: string;
    invalid: string;
    stricterOnly: string;
    lastChanged: string;
    save: string;
    saving: string;
    saved: string;
    reset: string;
    resetting: string;
    notePlaceholder: string;
    confirmTitle: string;
    confirmYes: string;
    confirmNo: string;
    history: string;
    hideHistory: string;
    noHistory: string;
    recent: string;
    errorGeneric: string;
    changeLine: string;
    fromDefault: string;
    toDefault: string;
    loadError: string;
    empty: string;
    nonProdBanner: string;
    on: string;
    off: string;
    emptyDefault: string;
    envForcedOff: string;
    envFallback: string;
    inForce: string;
    idPlaceholder: string;
    idsPlaceholder: string;
}

interface SettingView {
    key: string;
    area: string;
    areaLabel: string;
    label: string;
    help: string;
    input:
        | { type: "int"; min: number; max: number; unit?: string }
        | { type: "bool" }
        | { type: "channel"; kind: "text" | "voice" }
        | { type: "role" }
        | { type: "roleList" }
        | { type: "text"; maxLength: number; multiline?: boolean; placeholder?: string }
        | { type: "date" }
        | { type: "url"; maxLength: number };
    stricterOnly: boolean;
    default: SettingValue;
    value: SettingValue;
    override: SettingValue | null;
    modified: boolean;
    invalid: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
    toggle?: { env: string; envKill: boolean; envOn: boolean; effective: boolean };
    names?: Record<string, string>;
}

type SettingValue = number | boolean | string | string[];

/** How a value reads in the page: numbers with their unit, on/off, ids with their resolved names. */
function show(s: SettingView, v: SettingValue, labels: SettingsLabels): string {
    const names = s.names ?? {};
    if (typeof v === "boolean") return v ? labels.on : labels.off;
    if (Array.isArray(v)) return v.length === 0 ? labels.emptyDefault : v.map((id) => (names[id] ? `${names[id]} (${id})` : id)).join(", ");
    if (typeof v === "string") {
        if (v === "") return s.input.type === "channel" || s.input.type === "role" ? labels.emptyDefault : labels.empty;
        return names[v] ? `${names[v]} (${v})` : v;
    }
    return `${v}${s.input.type === "int" && s.input.unit ? ` ${s.input.unit}` : ""}`;
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

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

async function api(method: string, body?: unknown, query = ""): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const res = await fetch(`/api/admin/settings${query}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
}

function Row({ s, labels, onChanged }: { s: SettingView; labels: SettingsLabels; onChanged: () => void }) {
    const [text, setText] = useState(Array.isArray(s.value) ? s.value.join(", ") : String(s.value));
    // For a switch, s.value is what is in force (env may have it on), so the box starts there and Save
    // stays disabled until the choice differs from it.
    const [flag, setFlag] = useState(typeof s.value === "boolean" ? s.value : false);
    const [note, setNote] = useState("");
    const [state, setState] = useState<"idle" | "saving" | "saved" | "resetting">("idle");
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const [confirmIsReset, setConfirmIsReset] = useState(false);
    const [history, setHistory] = useState<Change[] | null>(null);

    // The value to send, by input kind.
    const next: SettingValue =
        s.input.type === "int" ? Number(text)
        : s.input.type === "bool" ? flag
        : s.input.type === "roleList" ? text.split(",").map((x) => x.trim()).filter(Boolean)
        : text.trim();
    const dirty =
        s.input.type === "int" ? text.trim() !== "" && next !== s.value
        : s.input.type === "bool" ? next !== s.value
        : JSON.stringify(next) !== JSON.stringify(s.value);

    async function save(confirmed: boolean) {
        setError(null);
        setState("saving");
        const r = await api("PUT", { key: s.key, value: next, note, confirm: confirmed, expectedUpdatedAt: s.updatedAt });
        if (r.status === 409 && typeof r.data.needsConfirm === "string") {
            setConfirm(r.data.needsConfirm);
            setConfirmIsReset(false);
            setState("idle");
            return;
        }
        if (!r.ok) {
            setError(typeof r.data.error === "string" ? r.data.error : labels.errorGeneric);
            setState("idle");
            return;
        }
        setConfirm(null);
        setNote("");
        setState("saved");
        onChanged();
    }

    async function reset(confirmed = false) {
        setError(null);
        setState("resetting");
        const r = await api("DELETE", { key: s.key, note, confirm: confirmed });
        if (r.status === 409 && typeof r.data.needsConfirm === "string") {
            setConfirm(r.data.needsConfirm);
            setConfirmIsReset(true);
            setState("idle");
            return;
        }
        if (!r.ok) {
            setError(typeof r.data.error === "string" ? r.data.error : labels.errorGeneric);
            setState("idle");
            return;
        }
        setNote("");
        setConfirm(null);
        setState("saved");
        onChanged();
    }

    async function toggleHistory() {
        if (history) return setHistory(null);
        const r = await api("GET", undefined, `?history=${encodeURIComponent(s.key)}`);
        setHistory(r.ok ? (r.data.changes as Change[]) : []);
    }

    return (
        <li className="grid gap-2 rounded-2xl border p-4" style={{ borderColor: s.invalid ? "tomato" : "hsl(var(--rule-warm) / 0.55)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-base font-bold">{s.label}</h3>
                <code className="text-xs text-foreground/50">{s.key}</code>
            </div>
            <p className="m-0 text-sm text-foreground/70">{s.help}</p>
            {s.stricterOnly && <p className="m-0 text-xs text-foreground/60">{labels.stricterOnly}</p>}
            {s.invalid && <p role="alert" className="m-0 text-sm text-tomato">{labels.invalid}</p>}
            {s.toggle?.envKill && <p className="m-0 text-sm font-bold text-tomato">{fill(labels.envForcedOff, { env: s.toggle.env })}</p>}
            {s.toggle && !s.toggle.envKill && !s.modified && <p className="m-0 text-xs text-foreground/60">{fill(labels.envFallback, { env: s.toggle.env })}</p>}
            {s.modified && (s.input.type === "channel" || s.input.type === "role" || s.input.type === "roleList") && (
                <p className="m-0 text-xs text-foreground/60">{show(s, s.value, labels)}</p>
            )}
            <div className="flex flex-wrap items-end gap-4 text-sm">
                <div>
                    <div className="text-foreground/50">{labels.codeDefault}</div>
                    <div className="font-bold tabular-nums">{show(s, s.default, labels)}</div>
                </div>
                {s.toggle && (
                    <div>
                        <div className="text-foreground/50">{labels.inForce}</div>
                        <div className="font-bold">{s.toggle.effective ? labels.on : labels.off}</div>
                    </div>
                )}
                <label className="grid gap-1">
                    <span className="text-foreground/50">
                        {labels.current}{s.input.type === "int" ? ` (${s.input.min}-${s.input.max})` : ""}
                        {s.modified && <span className="ml-2 rounded bg-tomato/15 px-1.5 py-0.5 text-xs text-tomato">{labels.modified}</span>}
                    </span>
                    {s.input.type === "int" ? (
                        <input
                            type="number"
                            inputMode="numeric"
                            min={s.input.min}
                            max={s.input.max}
                            step={1}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            className="w-28 rounded-lg border bg-background px-2 py-1 tabular-nums"
                            style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                        />
                    ) : s.input.type === "bool" ? (
                        <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} aria-label={s.label} className="h-5 w-5" />
                    ) : s.input.type === "text" && s.input.multiline ? (
                        <textarea
                            rows={5}
                            maxLength={s.input.maxLength}
                            placeholder={s.input.placeholder}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            className="w-80 max-w-full rounded-lg border bg-background px-2 py-1"
                            style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                        />
                    ) : (
                        <input
                            type={s.input.type === "date" ? "date" : s.input.type === "url" ? "url" : "text"}
                            maxLength={s.input.type === "text" || s.input.type === "url" ? s.input.maxLength : undefined}
                            placeholder={
                                s.input.type === "roleList" ? labels.idsPlaceholder
                                : s.input.type === "channel" || s.input.type === "role" ? labels.idPlaceholder
                                : s.input.type === "text" ? s.input.placeholder
                                : undefined
                            }
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            className={`${s.input.type === "channel" || s.input.type === "role" || s.input.type === "roleList" ? "w-72 font-mono text-xs" : "w-80"} max-w-full rounded-lg border bg-background px-2 py-1`}
                            style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                        />
                    )}
                </label>
                <input
                    type="text"
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={labels.notePlaceholder}
                    aria-label={labels.notePlaceholder}
                    className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                />
                <button type="button" onClick={() => save(false)} disabled={!dirty || state === "saving"} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {state === "saving" ? labels.saving : labels.save}
                </button>
                {s.modified && (
                    <button type="button" onClick={() => reset()} disabled={state === "resetting"} className="rounded-lg border px-3 py-1.5" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
                        {state === "resetting" ? labels.resetting : labels.reset}
                    </button>
                )}
                {state === "saved" && <span role="status" className="text-foreground/60">{labels.saved}</span>}
            </div>
            {confirm && (
                <div role="alertdialog" aria-label={labels.confirmTitle} className="grid gap-2 rounded-xl border border-tomato p-3 text-sm">
                    <strong>{labels.confirmTitle}</strong>
                    <span>{confirm}</span>
                    <span className="flex gap-2">
                        <button type="button" onClick={() => (confirmIsReset ? reset(true) : save(true))} className="rounded-lg bg-tomato px-3 py-1 font-bold text-white">{labels.confirmYes}</button>
                        <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border px-3 py-1" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>{labels.confirmNo}</button>
                    </span>
                </div>
            )}
            {error && <p role="alert" className="m-0 text-sm text-tomato">{error}</p>}
            <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
                {s.updatedAt && s.updatedBy && (
                    <span>{fill(labels.lastChanged, { who: s.updatedBy, when: new Date(s.updatedAt).toLocaleString() })}</span>
                )}
                <button type="button" onClick={toggleHistory} className="underline">{history ? labels.hideHistory : labels.history}</button>
            </div>
            {history && (
                <ul className="m-0 grid list-none gap-1 p-0 text-xs text-foreground/70">
                    {history.length === 0 && <li>{labels.noHistory}</li>}
                    {history.map((c) => (
                        <li key={c.id}>{changeText(c, labels)} <span className="text-foreground/50">({new Date(c.changedAt).toLocaleString()}){c.note ? ` - ${c.note}` : ""}</span></li>
                    ))}
                </ul>
            )}
        </li>
    );
}

function changeText(c: Change, labels: SettingsLabels): string {
    return fill(labels.changeLine, {
        key: c.key,
        from: c.oldValue === null || c.oldValue === undefined ? labels.fromDefault : String(c.oldValue).slice(0, 120),
        to: c.newValue === null || c.newValue === undefined ? labels.toDefault : String(c.newValue).slice(0, 120),
        who: c.changedBy,
    });
}

export function SettingsEditor({ labels }: { labels: SettingsLabels }) {
    const [settings, setSettings] = useState<SettingView[] | null>(null);
    const [changes, setChanges] = useState<Change[]>([]);
    const [nonProd, setNonProd] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        const r = await api("GET");
        if (!r.ok) return setFailed(true);
        setFailed(false);
        setSettings(r.data.settings as SettingView[]);
        setChanges(r.data.changes as Change[]);
        setNonProd(r.data.nonProduction === true);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (failed) return <p role="alert" className="text-tomato">{labels.loadError}</p>;
    if (!settings) return null;

    const areas = [...new Set(settings.map((s) => s.area))];
    return (
        <div className="grid gap-6">
            {nonProd && <p role="alert" className="m-0 rounded-xl border border-tomato bg-tomato/10 p-3 text-sm font-bold">{labels.nonProdBanner}</p>}
            {areas.map((area) => (
                <section key={area} className="grid gap-3">
                    <h2 className="m-0 font-[family-name:var(--font-display)] text-xl font-black">{settings.find((s) => s.area === area)?.areaLabel ?? area}</h2>
                    <ul className="m-0 grid list-none gap-3 p-0">
                        {settings.filter((s) => s.area === area).map((s) => (
                            <Row key={`${s.key}:${s.value}:${s.updatedAt}`} s={s} labels={labels} onChanged={load} />
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
                            <li key={c.id}>{changeText(c, labels)} <span className="text-foreground/50">({new Date(c.changedAt).toLocaleString()})</span></li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
