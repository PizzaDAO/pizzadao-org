// app/admin/features/page.tsx
//
// Editor for the public features catalog (plans/features-catalog.md): import the seed, review and edit
// rows, publish them, and check that the code links still resolve. Admin roles only (the same gate as the
// other admin pages); every API route behind it enforces the check again.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { AdminFeaturesClient } from "./AdminFeaturesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Features catalog", robots: { index: false, follow: false } };

export default async function AdminFeaturesPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isAdminDiscordId(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Not allowed</h1>
                    <p className="text-foreground/60">{session ? "This page is for admins." : "Log in to continue."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/features" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-6xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">Admin</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Features catalog</h1>
                    <p className="m-0 text-foreground/70">
                        Rows import unpublished and stay hidden until you publish them. The public page, the exports and the header link have
                        their own switches.
                    </p>
                    <p className="m-0 text-sm">
                        <Link href="/admin/settings" className="underline">Settings (area: Other feature switches)</Link>
                    </p>
                </header>
                <AdminFeaturesClient />
            </div>
        </main>
    );
}
