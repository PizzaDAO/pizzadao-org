// app/announce/edit/page.tsx
//
// Edit the Community Call announcement's specials on the website, once they moved off the sheet
// (plans/sheets-cutover.md). Announcers only; the API enforces the same check.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { canAnnounce } from "@/app/lib/announce/access";
import { announceFromDb } from "@/app/lib/announce/db";
import TableEditorClient from "@/app/admin/sheets/edit/[dataset]/TableEditorClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit announcement", robots: { index: false, follow: false } };

export default async function EditAnnouncementPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await canAnnounce(session.discordId) : false;
    const onWebsite = await announceFromDb();
    if (!allowed || !onWebsite) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center max-w-md">
                    <h1 className="text-2xl mb-3">{!allowed ? "Announcers only" : "Not on the website yet"}</h1>
                    <p className="text-foreground/60">
                        {!session ? "Please log in with Discord." : !allowed ? "Only announcers can edit the announcement." : "The announcement is still edited in its Google Sheet."}
                    </p>
                    <Link href={session ? "/announce" : "/login?returnTo=/announce/edit"} className="inline-block mt-4 underline">
                        {session ? "Back" : "Log in"}
                    </Link>
                </div>
            </main>
        );
    }
    return <TableEditorClient dataset="announce" apiUrl="/api/announce/specials" backHref="/announce" backLabel="Back to the announcement" />;
}
