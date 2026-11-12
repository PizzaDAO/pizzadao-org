// app/admin/members/names/page.tsx
//
// Themed-name report: members whose display name is not pizza/mafia themed, with an admin-triggered
// reminder DM. Dread Pizza Roberts only (same gate as the API route).

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { NamesClient } from "./NamesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Member names",
    robots: { index: false, follow: false },
};

export default async function AdminMemberNamesPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access denied</h1>
                    <p className="text-foreground/60">{session ? "This page is restricted to Dread Pizza Roberts." : "Please log in with Discord."}</p>
                    <Link href="/" className="inline-block mt-4 underline">Back to Dashboard</Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 max-w-3xl mx-auto">
            <h1 className="text-2xl mb-1">Member names</h1>
            <p className="text-foreground/60 mb-5">
                Members whose display name is not themed. Reminders are sent only when you press Send; nobody is renamed.
                The text and cooldown are in Settings under Members.
            </p>
            <NamesClient />
        </main>
    );
}
