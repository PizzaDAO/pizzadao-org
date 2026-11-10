// app/admin/map-levels/page.tsx
//
// Preview of the levels the public reach map would show (plans/map-city-levels.md). Dread Pizza
// Roberts only, the same gate as the settings page; the API route enforces it on every request.
// Plain English: admin-only, like the settings group names.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { MapLevelsPreview } from "./MapLevelsPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Map levels preview", robots: { index: false, follow: false } };

export default async function AdminMapLevelsPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Not allowed</h1>
                    <p className="text-foreground/60">{session ? "This page is for Dread Pizza Roberts." : "Log in to continue."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/map-levels" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-5xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">Admin</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Map levels preview</h1>
                    <p className="m-0 text-foreground/70">
                        What the pizzadao.org reach map would show, computed with the saved settings. Works while the public switch is off.
                        This page shows exact counts, scores and the City text members typed: keep it to yourself.
                    </p>
                    <p className="m-0 text-sm">
                        <Link href="/admin/settings" className="underline">Settings (area: Reach map levels)</Link>
                    </p>
                </header>
                <MapLevelsPreview />
            </div>
        </main>
    );
}
