// app/admin/support/page.tsx
//
// Admin support queue (buffalo-96244). Server-side admin gate; the API routes
// enforce the same check via requireAdmin().

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { AdminSupportClient } from "./AdminSupportClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Admin · Support",
    description: "Triage PizzaDAO support tickets.",
    robots: { index: false, follow: false },
};

export default async function AdminSupportPage() {
    const session = await getSession();
    const isAdmin = session?.discordId ? await isAdminDiscordId(session.discordId) : false;

    if (!isAdmin) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access Denied</h1>
                    <p className="text-foreground/60">
                        {session ? "This page is restricted to admins." : "Please log in with Discord."}
                    </p>
                    <Link href="/support" className="inline-block mt-4 underline">
                        ← Back to Support
                    </Link>
                </div>
            </main>
        );
    }

    return <AdminSupportClient />;
}
