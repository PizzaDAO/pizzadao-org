"use client";

import { useCallback, useEffect, useState } from "react";

interface Partner {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    countryCode: string | null;
    status: string;
    qrVersion: number;
    logoConsent: boolean;
}
interface Pending {
    id: number;
    discordId: string;
    pizzeria: string;
    city: string | null;
    method: string;
    distanceM: number | null;
    riskFlags: string[] | null;
    createdAt: string;
}

const EMPTY = { name: "", address: "", city: "", countryCode: "", lat: "", lng: "", website: "", logoUrl: "", logoConsent: false };

async function api(path: string, method: string, body?: unknown) {
    const r = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export function PassportAdmin() {
    const [partners, setPartners] = useState<Partner[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [form, setForm] = useState(EMPTY);
    const [msg, setMsg] = useState("");

    const load = useCallback(async () => {
        const r = await api("/api/admin/passport", "GET");
        if (r.ok) {
            setPartners(r.data.pizzerias);
            setPending(r.data.pending);
        } else setMsg(r.data.error ?? "Could not load");
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function add(e: React.FormEvent) {
        e.preventDefault();
        setMsg("");
        const r = await api("/api/admin/passport", "POST", form);
        if (r.ok) {
            setForm(EMPTY);
            setMsg(`Added ${r.data.slug}`);
            void load();
        } else setMsg(r.data.error ?? "Could not add");
    }

    async function review(id: number, approve: boolean) {
        const r = await api(`/api/admin/passport/checkins/${id}`, "POST", { approve });
        if (!r.ok) setMsg(r.data.error ?? "Could not update");
        void load();
    }

    async function patch(id: string, body: Record<string, unknown>) {
        const r = await api(`/api/admin/passport/${id}`, "PATCH", body);
        if (!r.ok) setMsg(r.data.error ?? "Could not update");
        void load();
    }

    const field = (k: keyof typeof EMPTY, label: string, required = false) => (
        <label className="block text-sm">
            {label}
            <input
                required={required}
                value={form[k] as string}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="mt-1 w-full rounded-md border px-3 py-2 bg-background"
            />
        </label>
    );

    return (
        <main className="min-h-screen bg-background text-foreground px-4 py-8">
            <div className="mx-auto max-w-3xl space-y-10">
                <header>
                    <h1 className="text-3xl mb-1">Pizza Passport partners</h1>
                    <p className="text-foreground/60 text-sm">
                        Turn the feature on at Admin settings (Pizza Passport). Set PASSPORT_QR_SECRET before printing QR codes.
                    </p>
                    {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
                </header>

                <section>
                    <h2 className="text-xl mb-3">Add a partner</h2>
                    <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
                        {field("name", "Name", true)}
                        {field("address", "Address")}
                        {field("city", "City")}
                        {field("countryCode", "Country code (2 letters)")}
                        {field("lat", "Latitude (blank to look up the address)")}
                        {field("lng", "Longitude")}
                        {field("website", "Website (https)")}
                        {field("logoUrl", "Logo URL (https, optional)")}
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                            <input
                                type="checkbox"
                                checked={form.logoConsent}
                                onChange={(e) => setForm({ ...form, logoConsent: e.target.checked })}
                            />
                            The partner agreed that PizzaDAO may show its logo as a passport stamp in the app and on social shares
                            (revocable by email).
                        </label>
                        <button type="submit" className="rounded-full bg-tomato text-white px-5 py-2 sm:col-span-2 justify-self-start">
                            Add partner
                        </button>
                    </form>
                </section>

                <section>
                    <h2 className="text-xl mb-3">Held check-ins ({pending.length})</h2>
                    {pending.length === 0 && <p className="text-foreground/60 text-sm">Nothing waiting.</p>}
                    <ul className="space-y-2 list-none p-0">
                        {pending.map((c) => (
                            <li key={c.id} className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3">
                                <span className="flex-1 min-w-[12rem]">
                                    {c.pizzeria}
                                    {c.city ? `, ${c.city}` : ""} · {c.method}
                                    {c.distanceM != null ? ` · ${c.distanceM} m` : ""} · {(c.riskFlags ?? []).join(", ") || "no flags"} · member {c.discordId}
                                </span>
                                <button type="button" onClick={() => review(c.id, true)} className="underline">
                                    Release
                                </button>
                                <button type="button" onClick={() => review(c.id, false)} className="underline">
                                    Reject
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h2 className="text-xl mb-3">Partners ({partners.length})</h2>
                    <ul className="space-y-2 list-none p-0">
                        {partners.map((p) => (
                            <li key={p.id} className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3">
                                <span className="flex-1 min-w-[12rem]">
                                    {p.name}
                                    {p.city ? `, ${p.city}` : ""} · {p.status} · QR v{p.qrVersion}
                                    {p.logoConsent ? " · logo ok" : ""}
                                </span>
                                <a href={`/api/admin/passport/${p.id}/qr`} target="_blank" rel="noreferrer" className="underline">
                                    Print QR
                                </a>
                                <button
                                    type="button"
                                    onClick={() => confirm("Printed QR codes stop working. Continue?") && patch(p.id, { bumpQr: true })}
                                    className="underline"
                                >
                                    Rotate QR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => patch(p.id, { status: p.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" })}
                                    className="underline"
                                >
                                    {p.status === "ACTIVE" ? "Hide" : "Activate"}
                                </button>
                                {p.logoConsent && (
                                    <button type="button" onClick={() => patch(p.id, { logoConsent: false })} className="underline">
                                        Revoke logo
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </main>
    );
}
