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
    incomeRole: string;
    incomeAmount: string;
    incomeEvery: string;
    incomeRemove: string;
    addRow: string;
    removeRow: string;
    listHint: string;
    editedElsewhere: string;
    cellRequired: string;
}

interface IncomeRow {
    name: string;
    amount: number;
    intervalHours: number;
    roleId?: string;
}

type TableRow = Record<string, string | number>;
type TableColumn =
    | { key: string; label: string; kind: "text"; maxLength?: number; fixed?: boolean }
    | { key: string; label: string; kind: "int"; min: number; max: number };

interface SettingView {
    key: string;
    area: string;
    areaLabel: string;
    label: string;
    help: string;
    input:
        | { type: "int"; min: number; max: number; unit?: string }
        | { type: "bool" }
        | { type: "roleIncome" }
        | { type: "channel"; kind: "text" | "voice" }
        | { type: "role" }
        | { type: "roleList" }
        | { type: "text"; maxLength: number; multiline?: boolean; placeholder?: string }
        | { type: "date" }
        | { type: "url"; maxLength: number }
        | { type: "stringList"; maxItems: number; maxLength: number }
        | { type: "table"; columns: TableColumn[]; maxRows: number; fixedRows?: boolean }
        | { type: "managed"; href: string };
    stricterOnly: boolean;
    default: SettingValue;
    baseline?: SettingValue;
    legacyEnv?: string;
    value: SettingValue;
    override: SettingValue | null;
    modified: boolean;
    invalid: boolean;
    warning?: string;
    private?: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
    toggle?: { env: string; envKill: boolean; envOn: boolean; effective: boolean };
    names?: Record<string, string>;
}

type SettingValue = number | boolean | string | string[] | IncomeRow[] | TableRow[];

/** How a value reads in the page: numbers with their unit, on/off, ids with their resolved names. */
function show(s: SettingView, v: SettingValue, labels: SettingsLabels): string {
    const names = s.names ?? {};
    if (s.input.type === "roleIncome" && Array.isArray(v)) {
        return (v as IncomeRow[]).map((r) => `${r.name} ${r.amount}/${r.intervalHours}h`).join(", ");
    }
    if (s.input.type === "table" && Array.isArray(v)) {
        const cols = s.input.columns;
        return (v as TableRow[]).map((r) => cols.map((c) => String(r[c.key])).join(" ")).join(", ");
    }
    if (typeof v === "boolean") return v ? labels.on : labels.off;
    if (s.input.type === "stringList" && Array.isArray(v)) return `${v.length}`;
    if (Array.isArray(v)) return v.length === 0 ? labels.emptyDefault : (v as string[]).map((id) => (names[id] ? `${names[id]} (${id})` : id)).join(", ");
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
    // A private value is never sent to the page (only "set" / "not set"), so its box starts empty: saving replaces it.
    const [text, setText] = useState(
        s.private || s.input.type === "roleIncome" || s.input.type === "table" || s.input.type === "managed" ? ""
        : s.input.type === "stringList" && Array.isArray(s.value) ? (s.value as string[]).join("\n")
        : Array.isArray(s.value) ? (s.value as string[]).join(", ")
        : String(s.value),
    );
    const tableInput = s.input.type === "table" ? s.input : null;
    const [rows, setRows] = useState<TableRow[]>(s.input.type === "table" && Array.isArray(s.value) ? (s.value as TableRow[]).map((r) => ({ ...r })) : []);
    // A cleared number cell is invalid (never coerced to 0): Save stays blocked and the cell says so.
    const emptyCell = !!tableInput && rows.some((r) => tableInput.columns.some((c) => c.kind === "int" && r[c.key] === ""));
    // The role income table: editable copy of the rows (only amounts and intervals change; rows can be removed).
    const [income, setIncome] = useState<IncomeRow[]>(s.input.type === "roleIncome" && Array.isArray(s.value) ? (s.value as IncomeRow[]).map((r) => ({ ...r })) : []);
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
        : s.input.type === "roleIncome" ? income
        : s.input.type === "table" ? rows
        : s.input.type === "stringList" ? text.split("\n").map((x) => x.trim()).filter(Boolean)
        : s.input.type === "roleList" ? text.split(",").map((x) => x.trim()).filter(Boolean)
        : text.trim();
    const dirty =
        s.input.type === "roleIncome" ? income.length > 0 && JSON.stringify(income) !== JSON.stringify(s.value)
        : s.input.type === "table" ? rows.length > 0 && !emptyCell && JSON.stringify(rows) !== JSON.stringify(s.value)
        : s.private && s.input.type === "text" ? text.trim() !== ""
        : s.input.type === "stringList" ? (next as string[]).length > 0 && JSON.stringify(next) !== JSON.stringify(s.value)
        : s.input.type === "int" ? text.trim() !== "" && next !== s.value
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
            {s.warning && <p role="alert" className="m-0 rounded-lg border border-tomato bg-tomato/10 p-2 text-sm font-bold text-tomato">{s.warning}</p>}
            {s.toggle?.envKill && <p className="m-0 text-sm font-bold text-tomato">{fill(labels.envForcedOff, { env: s.toggle.env })}</p>}
            {s.toggle && !s.toggle.envKill && !s.modified && <p className="m-0 text-xs text-foreground/60">{fill(labels.envFallback, { env: s.toggle.env })}</p>}
            {s.legacyEnv && !s.toggle && !s.modified && JSON.stringify(s.baseline) !== JSON.stringify(s.default) && (
                <p className="m-0 text-xs text-foreground/60">{fill(labels.envFallback, { env: s.legacyEnv })} {show(s, s.baseline as SettingValue, labels)}</p>
            )}
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
                    ) : s.input.type === "roleIncome" ? (
                        <table className="text-sm">
                            <thead>
                                <tr className="text-left text-foreground/50">
                                    <th className="pr-3 font-normal">{labels.incomeRole}</th>
                                    <th className="pr-3 font-normal">{labels.incomeAmount}</th>
                                    <th className="pr-3 font-normal">{labels.incomeEvery}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {income.map((r, i) => (
                                    <tr key={r.name}>
                                        <td className="pr-3">{r.name}</td>
                                        <td className="pr-3">
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={1}
                                                max={10000}
                                                step={1}
                                                value={r.amount}
                                                aria-label={`${r.name} ${labels.incomeAmount}`}
                                                onChange={(e) => setIncome(income.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))}
                                                className="w-24 rounded-lg border bg-background px-2 py-1 tabular-nums"
                                                style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                                            />
                                        </td>
                                        <td className="pr-3">
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={1}
                                                max={720}
                                                step={1}
                                                value={r.intervalHours}
                                                aria-label={`${r.name} ${labels.incomeEvery}`}
                                                onChange={(e) => setIncome(income.map((x, j) => (j === i ? { ...x, intervalHours: Number(e.target.value) } : x)))}
                                                className="w-20 rounded-lg border bg-background px-2 py-1 tabular-nums"
                                                style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                                            />
                                        </td>
                                        <td>
                                            <button type="button" onClick={() => setIncome(income.filter((_, j) => j !== i))} className="underline">
                                                {labels.incomeRemove}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : s.input.type === "table" ? (
                        <div className="grid gap-1">
                            <table className="text-sm">
                                <thead>
                                    <tr className="text-left text-foreground/50">
                                        {s.input.columns.map((c) => (
                                            <th key={c.key} className="pr-3 font-normal">{c.label}</th>
                                        ))}
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={i}>
                                            {s.input.type === "table" && s.input.columns.map((c) => (
                                                <td key={c.key} className="pr-3">
                                                    {c.kind === "text" && c.fixed ? (
                                                        <code className="text-xs">{String(r[c.key])}</code>
                                                    ) : (
                                                        <input
                                                            type={c.kind === "int" ? "number" : "text"}
                                                            inputMode={c.kind === "int" ? "numeric" : undefined}
                                                            min={c.kind === "int" ? c.min : undefined}
                                                            max={c.kind === "int" ? c.max : undefined}
                                                            maxLength={c.kind === "text" ? c.maxLength : undefined}
                                                            value={r[c.key]}
                                                            aria-label={`${String(r[s.input.type === "table" ? s.input.columns[0].key : ""])} ${c.label}`}
                                                            onChange={(e) =>
                                                                setRows(rows.map((x, j) => (j === i ? { ...x, [c.key]: c.kind === "int" ? (e.target.value.trim() === "" ? "" : Number(e.target.value)) : e.target.value } : x)))
                                                            }
                                                            className={`${c.kind === "int" ? "w-28 tabular-nums" : "w-40"} rounded-lg border bg-background px-2 py-1`}
                                                            style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                                                        />
                                                    )}
                                                    {c.kind === "int" && r[c.key] === "" && <span role="alert" className="block text-xs text-tomato">{labels.cellRequired}</span>}
                                                </td>
                                            ))}
                                            <td>
                                                {!tableInput?.fixedRows && (
                                                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="underline">
                                                        {labels.removeRow}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!s.input.fixedRows && rows.length < s.input.maxRows && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (s.input.type !== "table") return;
                                        setRows([...rows, Object.fromEntries(s.input.columns.map((c) => [c.key, c.kind === "int" ? 0 : ""]))]);
                                    }}
                                    className="w-fit underline"
                                >
                                    {labels.addRow}
                                </button>
                            )}
                        </div>
                    ) : s.input.type === "stringList" ? (
                        <div className="grid gap-1">
                            <textarea
                                rows={6}
                                value={text}
                                aria-label={s.label}
                                onChange={(e) => setText(e.target.value)}
                                className="w-96 max-w-full rounded-lg border bg-background px-2 py-1"
                                style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                            />
                            <span className="text-xs text-foreground/60">{fill(labels.listHint, { max: String(s.input.maxItems), chars: String(s.input.maxLength) })}</span>
                        </div>
                    ) : s.input.type === "managed" ? (
                        <a href={s.input.href} className="underline">{labels.editedElsewhere}</a>
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
                {s.input.type !== "managed" && <input
                    type="text"
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={labels.notePlaceholder}
                    aria-label={labels.notePlaceholder}
                    className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                />}
                {s.input.type !== "managed" && <button type="button" onClick={() => save(false)} disabled={!dirty || state === "saving"} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                    {state === "saving" ? labels.saving : labels.save}
                </button>}
                {s.modified && s.input.type !== "managed" && (
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
