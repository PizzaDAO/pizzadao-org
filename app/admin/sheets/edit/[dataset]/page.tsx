// app/admin/sheets/edit/[dataset]/page.tsx
//
// Website editor for a data set that moved off Google Sheets (plans/sheets-cutover.md). Admins only;
// the API route enforces the same check. Admin-only English (not translated).

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import TableEditorClient from "./TableEditorClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit data", robots: { index: false, follow: false } };

export default async function EditSheetDataPage({ params }: { params: Promise<{ dataset: string }> }) {
    const { dataset } = await params;
    const session = await getSession();
    const allowed = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access denied</h1>
                    <p className="text-foreground/60">{session ? "This page is restricted to admins." : "Please log in with Discord."}</p>
                    {!session && (
                        <Link href={`/login?returnTo=/admin/sheets/edit/${encodeURIComponent(dataset)}`} className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }
    return <TableEditorClient dataset={dataset} />;
}
