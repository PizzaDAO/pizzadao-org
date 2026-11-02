// app/admin/sheets/page.tsx
//
// Google Sheets cutover (plans/sheets-cutover.md): every data set, where it reads from, its last
// import, and Import (dry run / apply) buttons. Dread Pizza Roberts only, like /admin/settings; the
// API routes enforce the same check on every request. Admin-only English (not translated).

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import SheetsAdminClient from "./SheetsAdminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Sheets cutover",
    robots: { index: false, follow: false },
};

export default async function AdminSheetsPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;
    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access denied</h1>
                    <p className="text-foreground/60">{session ? "This page is restricted." : "Please log in with Discord."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/sheets" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }
    return <SheetsAdminClient />;
}
