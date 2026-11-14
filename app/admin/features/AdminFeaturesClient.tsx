"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AUDIENCES, ENTRY_STATUSES, type CodeRef } from "@/app/lib/features/types";

interface AppRowT {
    slug: string; name: string; tagline: string; url: string | null; repo: string | null; repoPrivate: boolean;
    defaultBranch: string | null; license: string | null; licenseNote: string | null; kind: string; position: number; published: boolean;
}
interface EntryRowT {
    slug: string; appSlug: string; title: string; summary: string; body: string | null; audiences: string[]; tags: string[];
    status: string; access: string; toggleKey: string | null; liveUrl: string | null; docsUrl: string | null; code: CodeRef[];
    published: boolean; showWhenOff: boolean; position: number; reviewedAt: string | null; updatedAt: string;
    linkCheck: { checkedAt: string; broken: number; results: { repo: string; path: string; status: string }[] } | null;
    switchOn: boolean | null;
}
interface Data {
    apps: AppRowT[]; entries: EntryRowT[];
    switches: { publicEnabled: boolean; exportEnabled: boolean; navLinkEnabled: boolean; showOps: boolean };
}

const inp = "w-full rounded border border-foreground/25 bg-background px-2 py-1 text-sm";
const btn = "rounded-full border border-foreground/30 px-3 py-1 text-sm hover:bg-foreground/10 disabled:opacity-50";
const th = "text-left font-semibold px-2 py-1 border-b border-foreground/15";
const td = "px-2 py-1 border-b border-foreground/10 align-top";

async function call(method: string, url: string, body?: unknown) {
    const res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b?.issues?.join("; ") || b?.error || `Error ${res.status}`);
    return b;
}

export function AdminFeaturesClient() {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState("");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState<"features" | "apps">("features");
    const [open, setOpen] = useState<string | null>(null);
    const [filter, setFilter] = useState("");

    const load = useCallback(async () => {
        try {
            setData((await call("GET", "/api/admin/features")) as Data);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load");
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);

    const act = async (label: string, fn: () => Promise<unknown>) => {
        setBusy(true);
        setNote("");
        try {
            const r = await fn();
            setNote(`${label}: ${JSON.stringify(r)}`);
            await load();
        } catch (e) {
            setNote(`${label} failed: ${e instanceof Error ? e.message : "error"}`);
        } finally {
            setBusy(false);
        }
    };

    const repos = useMemo(() => {
        const s = new Set<string>();
        data?.apps.forEach((a) => a.repo && s.add(a.repo));
        data?.entries.forEach((e) => e.code.forEach((c) => s.add(c.repo.replace(/^PizzaDAO\//, ""))));
        return [...s].sort();
    }, [data]);

    if (error) return <p className="text-red-600">{error}</p>;
    if (!data) return <p className="text-foreground/60">Loading...</p>;

    const appName = new Map(data.apps.map((a) => [a.slug, a.name]));
    const needle = filter.trim().toLowerCase();
    const entries = data.entries.filter((e) => !needle || `${e.slug} ${e.title} ${e.appSlug}`.toLowerCase().includes(needle));
    const broken = data.entries.filter((e) => (e.linkCheck?.broken ?? 0) > 0);
    const stale = data.entries.filter((e) => !e.reviewedAt || Date.now() - new Date(e.reviewedAt).getTime() > 90 * 86400000).length;
    const unpublishedApps = new Set(data.apps.filter((a) => !a.published).map((a) => a.slug));

    const patchEntry = (slug: string, patch: Record<string, unknown>) => act(`Saved ${slug}`, () => call("PATCH", "/api/admin/features/entries", { slug, patch }));
    const patchApp = (slug: string, patch: Record<string, unknown>) => act(`Saved ${slug}`, () => call("PATCH", "/api/admin/features/apps", { slug, patch }));

    return (
        <div className="grid gap-5 text-sm">
            <section className="grid gap-2">
                <div className="flex flex-wrap gap-2 items-center">
                    <button className={btn} disabled={busy} onClick={() => act("Import", () => call("POST", "/api/admin/features/import", {}))}>Import seed</button>
                    <button className={btn} disabled={busy} onClick={() => act("Check links", () => call("POST", "/api/admin/features/check-links", {}))}>Check links</button>
                    <button className={btn} disabled={busy} onClick={() => confirm("Publish every app and feature?") && act("Publish all", () => call("POST", "/api/admin/features/publish", { published: true }))}>Publish all</button>
                    <button className={btn} disabled={busy} onClick={() => act("Unpublish all", () => call("POST", "/api/admin/features/publish", { published: false }))}>Unpublish all</button>
                </div>
                {note && <p className="m-0 break-words text-foreground/70">{note}</p>}
                <p className="m-0 text-foreground/70">
                    Public page {data.switches.publicEnabled ? "ON" : "off"} | exports {data.switches.exportEnabled ? "ON" : "off"} | header link{" "}
                    {data.switches.navLinkEnabled ? "ON" : "off"} | ops tools {data.switches.showOps ? "shown" : "hidden"}. {data.entries.length} features,{" "}
                    {data.entries.filter((e) => e.published).length} published; {stale} not reviewed in 90 days.
                </p>
                {broken.length > 0 && (
                    <div className="rounded border border-red-500/40 bg-red-500/10 p-3">
                        <p className="m-0 font-semibold">Broken links ({broken.length} features)</p>
                        <ul className="m-0 mt-1 pl-5 list-disc">
                            {broken.map((e) => (
                                <li key={e.slug}>
                                    {e.slug}: {e.linkCheck?.results.filter((r) => r.status === "missing" || r.status === "unlisted").map((r) => `${r.repo}/${r.path} (${r.status})`).join(", ")}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            <div className="flex gap-2">
                <button className={btn} aria-pressed={tab === "features"} onClick={() => setTab("features")}>Features</button>
                <button className={btn} aria-pressed={tab === "apps"} onClick={() => setTab("apps")}>Apps</button>
                {tab === "features" && <input className={inp + " max-w-xs"} placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />}
            </div>

            {tab === "apps" ? (
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead><tr><th className={th}>Slug</th><th className={th}>Name</th><th className={th}>Repo</th><th className={th}>License</th><th className={th}>Order</th><th className={th}>Published</th></tr></thead>
                        <tbody>
                            {data.apps.map((a) => (
                                <AppRowEditor key={a.slug + a.position + a.published + a.name + (a.license ?? "") + (a.repo ?? "")} a={a} onSave={(p) => patchApp(a.slug, p)} busy={busy} td={td} />
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <datalist id="repo-list">{repos.map((r) => <option key={r} value={r} />)}</datalist>
                    <table className="w-full border-collapse">
                        <thead><tr><th className={th}>Feature</th><th className={th}>App</th><th className={th}>Status</th><th className={th}>Switch</th><th className={th}>Links</th><th className={th}>Published</th><th className={th} /></tr></thead>
                        <tbody>
                            {entries.map((e) => (
                                <EntryRows
                                    key={e.slug}
                                    e={e}
                                    appName={appName.get(e.appSlug) ?? e.appSlug}
                                    appHidden={unpublishedApps.has(e.appSlug)}
                                    open={open === e.slug}
                                    onToggle={() => setOpen(open === e.slug ? null : e.slug)}
                                    onSave={(p) => patchEntry(e.slug, p)}
                                    busy={busy}
                                    apps={data.apps}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function AppRowEditor({ a, onSave, busy, td }: { a: AppRowT; onSave: (p: Record<string, unknown>) => void; busy: boolean; td: string }) {
    const [name, setName] = useState(a.name);
    const [repo, setRepo] = useState(a.repo ?? "");
    const [license, setLicense] = useState(a.license ?? "");
    const [position, setPosition] = useState(String(a.position));
    return (
        <tr>
            <td className={td}>{a.slug}</td>
            <td className={td}><input className={inp} value={name} onChange={(e) => setName(e.target.value)} /></td>
            <td className={td}><input className={inp} value={repo} onChange={(e) => setRepo(e.target.value)} /></td>
            <td className={td}><input className={inp} value={license} placeholder="none" onChange={(e) => setLicense(e.target.value)} /></td>
            <td className={td}><input className={inp + " w-20"} value={position} onChange={(e) => setPosition(e.target.value)} /></td>
            <td className={td}>
                <input type="checkbox" checked={a.published} disabled={busy} onChange={(e) => onSave({ published: e.target.checked })} />{" "}
                <button className="underline" disabled={busy} onClick={() => onSave({ name, repo: repo || null, license: license || null, position: Number(position) || 0 })}>Save</button>
            </td>
        </tr>
    );
}

function EntryRows({ e, appName, appHidden, open, onToggle, onSave, busy, apps }: {
    e: EntryRowT; appName: string; appHidden: boolean; open: boolean; onToggle: () => void; onSave: (p: Record<string, unknown>) => void; busy: boolean; apps: AppRowT[];
}) {
    const [f, setF] = useState({
        title: e.title, summary: e.summary, status: e.status, access: e.access, toggleKey: e.toggleKey ?? "", liveUrl: e.liveUrl ?? "",
        audiences: e.audiences, position: String(e.position), showWhenOff: e.showWhenOff, appSlug: e.appSlug, code: e.code as CodeRef[],
    });
    const brokenCount = e.linkCheck?.broken ?? 0;
    const save = () =>
        onSave({
            title: f.title, summary: f.summary, status: f.status, access: f.access, toggleKey: f.toggleKey, liveUrl: f.liveUrl, audiences: f.audiences,
            position: Number(f.position) || 0, showWhenOff: f.showWhenOff, appSlug: f.appSlug, code: f.code.filter((c) => c.repo.trim()),
        });
    const setCode = (i: number, patch: Partial<CodeRef>) => setF({ ...f, code: f.code.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    return (
        <>
            <tr className={e.published ? "" : "text-foreground/60"}>
                <td className={td}><b>{e.title}</b><br /><span className="text-foreground/50">{e.slug}</span></td>
                <td className={td}>{appName}{appHidden && <span className="text-red-600"> (app unpublished)</span>}</td>
                <td className={td}>{e.status}{e.access !== "public" ? `, ${e.access}` : ""}</td>
                <td className={td}>{e.toggleKey ? `${e.toggleKey}: ${e.switchOn ? "on" : "off"}` : "-"}</td>
                <td className={td}>{e.linkCheck ? (brokenCount > 0 ? <span className="text-red-600">{brokenCount} broken</span> : "ok") : "unchecked"}</td>
                <td className={td}><input type="checkbox" checked={e.published} disabled={busy} onChange={(ev) => onSave({ published: ev.target.checked })} aria-label={`Publish ${e.slug}`} /></td>
                <td className={td}><button className="underline" onClick={onToggle}>{open ? "Close" : "Edit"}</button></td>
            </tr>
            {open && (
                <tr>
                    <td className={td} colSpan={7}>
                        <div className="grid gap-3 md:grid-cols-2">
                            <label className="grid gap-1">Title<input className={inp} value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} /></label>
                            <label className="grid gap-1">App
                                <select className={inp} value={f.appSlug} onChange={(ev) => setF({ ...f, appSlug: ev.target.value })}>
                                    {apps.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                                </select>
                            </label>
                            <label className="grid gap-1 md:col-span-2">Summary (160 max)<input className={inp} maxLength={160} value={f.summary} onChange={(ev) => setF({ ...f, summary: ev.target.value })} /></label>
                            <label className="grid gap-1">Status
                                <select className={inp} value={f.status} onChange={(ev) => setF({ ...f, status: ev.target.value })}>
                                    {ENTRY_STATUSES.map((s) => <option key={s}>{s}</option>)}
                                </select>
                            </label>
                            <label className="grid gap-1">Access (public, members, admin, level:N)<input className={inp} value={f.access} onChange={(ev) => setF({ ...f, access: ev.target.value })} /></label>
                            <label className="grid gap-1">Switch key (settings key; blank: none)<input className={inp} value={f.toggleKey} onChange={(ev) => setF({ ...f, toggleKey: ev.target.value })} /></label>
                            <label className="grid gap-1">Live link (path or URL)<input className={inp} value={f.liveUrl} onChange={(ev) => setF({ ...f, liveUrl: ev.target.value })} /></label>
                            <div className="grid gap-1">Audiences
                                <div className="flex flex-wrap gap-3">
                                    {AUDIENCES.map((a) => (
                                        <label key={a} className="flex items-center gap-1">
                                            <input type="checkbox" checked={f.audiences.includes(a)} onChange={(ev) => setF({ ...f, audiences: ev.target.checked ? [...f.audiences, a] : f.audiences.filter((x) => x !== a) })} />
                                            {a}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1"><input type="checkbox" checked={f.showWhenOff} onChange={(ev) => setF({ ...f, showWhenOff: ev.target.checked })} />Show as coming soon when its switch is off</label>
                                <label className="flex items-center gap-1">Order<input className={inp + " w-20"} value={f.position} onChange={(ev) => setF({ ...f, position: ev.target.value })} /></label>
                            </div>
                            <div className="grid gap-2 md:col-span-2">
                                <b>Code</b>
                                {f.code.map((c, i) => (
                                    <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_2fr_auto_auto]">
                                        <input className={inp} list="repo-list" placeholder="repo" value={c.repo.replace(/^PizzaDAO\//, "")} onChange={(ev) => setCode(i, { repo: ev.target.value })} />
                                        <input className={inp} placeholder="path" value={c.path ?? ""} onChange={(ev) => setCode(i, { path: ev.target.value })} />
                                        <input className={inp} placeholder="description" value={c.description ?? ""} onChange={(ev) => setCode(i, { description: ev.target.value })} />
                                        <label className="flex items-center gap-1"><input type="checkbox" checked={!!c.private} onChange={(ev) => setCode(i, { private: ev.target.checked })} />private</label>
                                        <button className="underline" onClick={() => setF({ ...f, code: f.code.filter((_, j) => j !== i) })}>Remove</button>
                                    </div>
                                ))}
                                <button className={btn + " justify-self-start"} onClick={() => setF({ ...f, code: [...f.code, { repo: "" }] })}>Add code path</button>
                            </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <button className={btn} disabled={busy} onClick={save}>Save</button>
                            <button className={btn} disabled={busy} onClick={() => onSave({ markReviewed: true })}>Mark reviewed{e.reviewedAt ? ` (last ${e.reviewedAt.slice(0, 10)})` : ""}</button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
