"use client";

import { useEffect, useState } from "react";
import type { AdminPreview } from "@/app/lib/map-levels/preview";

const th = "text-left font-semibold px-2 py-1 border-b border-foreground/15";
const td = "px-2 py-1 border-b border-foreground/10 align-top";

export function MapLevelsPreview() {
    const [data, setData] = useState<AdminPreview | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let alive = true;
        fetch("/api/admin/map-levels/preview", { cache: "no-store" })
            .then(async (r) => {
                const b = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(b?.error || `Error ${r.status}`);
                return b as AdminPreview;
            })
            .then((b) => alive && setData(b))
            .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load"));
        return () => {
            alive = false;
        };
    }, []);

    if (error) return <p className="text-red-600">{error}</p>;
    if (!data) return <p className="text-foreground/60">Working it out...</p>;
    const t = data.totals;

    return (
        <div className="grid gap-8 text-sm">
            <section className="grid gap-1">
                <h2 className="text-lg font-bold m-0">Totals</h2>
                <p className="m-0">
                    {t.members} members: {t.inCity} in a map city, {t.countryOnly} country only, {t.unplaced} not placed.
                </p>
                <p className="m-0 text-foreground/70">
                    {t.mapCities} map cities known (synced {t.mapCitiesSynced}); {data.mapCitiesWithoutMembers} have no members. A city added on the site needs a sync
                    (scripts/map-levels/sync-cities.mjs) before it can get a level.
                </p>
            </section>

            <section className="grid gap-2">
                <h2 className="text-lg font-bold m-0">Cities</h2>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr><th className={th}>City</th><th className={th}>Country</th><th className={th}>Members</th><th className={th}>With Discord</th><th className={th}>Score</th><th className={th}>Tier</th><th className={th}>Shown</th></tr>
                        </thead>
                        <tbody>
                            {data.cities.map((c) => (
                                <tr key={c.key} className={c.passes ? "" : "text-foreground/50"}>
                                    <td className={td}>{c.name}</td><td className={td}>{c.country}</td><td className={td}>{c.members}</td><td className={td}>{c.scored}</td>
                                    <td className={td}>{c.score}</td><td className={td}>{c.tier}</td><td className={td}>{c.passes ? "yes" : "hidden (below minimum)"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="grid gap-2">
                <h2 className="text-lg font-bold m-0">Countries</h2>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr><th className={th}>Country</th><th className={th}>Members</th><th className={th}>With Discord</th><th className={th}>Score</th><th className={th}>Tier</th><th className={th}>Shown</th></tr>
                        </thead>
                        <tbody>
                            {data.countries.map((c) => (
                                <tr key={c.iso2} className={c.passes ? "" : "text-foreground/50"}>
                                    <td className={td}>{c.name}</td><td className={td}>{c.members}</td><td className={td}>{c.scored}</td>
                                    <td className={td}>{c.score}</td><td className={td}>{c.tier}</td><td className={td}>{c.passes ? "yes" : "hidden (below minimum)"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="grid gap-2">
                <h2 className="text-lg font-bold m-0">Unmatched and country-only City values</h2>
                <p className="m-0 text-foreground/70">
                    What members typed that did not land in a map city. To fix one, add a row under Settings, Map place aliases: typed text on the left, a map city key
                    (for example new-york-city-840), country:XX or ignore on the right. Matching ignores case and accents.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead><tr><th className={th}>Typed as</th><th className={th}>Members</th><th className={th}>Outcome</th></tr></thead>
                        <tbody>
                            {data.unmatched.map((u) => (
                                <tr key={`${u.value}|${u.outcome}`}><td className={td}>{u.value}</td><td className={td}>{u.count}</td><td className={td}>{u.outcome}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="grid gap-2">
                <h2 className="text-lg font-bold m-0">What the public sees</h2>
                <p className="m-0 text-foreground/70">The exact body of /api/public/map-levels once the switch is on.</p>
                <pre className="overflow-auto rounded border border-foreground/15 p-3 text-xs">{JSON.stringify(data.public, null, 2)}</pre>
            </section>
        </div>
    );
}
