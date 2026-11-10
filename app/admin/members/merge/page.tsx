// app/admin/members/merge/page.tsx
//
// Member merge (app/lib/members/merge.ts). Dread Pizza Roberts only, pinned to the role id.
// The API route enforces the same check on every request.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { MergeClient } from "./MergeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Merge members",
    robots: { index: false, follow: false },
};

export default async function AdminMembersMergePage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access denied</h1>
                    <p className="text-foreground/60">{session ? "This page is restricted to Dread Pizza Roberts." : "Please log in with Discord."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/members/merge" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-3xl grid gap-5">
                <header className="grid gap-2">
                    <h1 className="text-2xl m-0">Merge members</h1>
                    <p className="text-foreground/70 m-0">
                        Fold a duplicate member into the one to keep. Preview first; nothing changes until you confirm.
                    </p>
                </header>
                <MergeClient />
            </div>
        </main>
    );
}
