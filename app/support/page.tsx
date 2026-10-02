// app/support/page.tsx
//
// Member support tickets (buffalo-96244). Logged-in members submit a ticket and
// see the status of their previous ones. Admins triage at /admin/support.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { SupportClient } from "./SupportClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Support",
    description: "Get help from the PizzaDAO team",
    robots: { index: false, follow: false },
};

export default async function SupportPage() {
    const session = await getSession();

    if (!session?.discordId) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div
                    className="paper-soft grid gap-4 rounded-[28px] border p-7 max-w-md w-full"
                    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                >
                    <p className="overline text-tomato m-0">§ Support</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Need a hand?</h1>
                    <p className="m-0 text-foreground/70">Log in with Discord to open a support ticket.</p>
                    <Link
                        href="/login"
                        className="btn-pill self-start"
                        style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}
                    >
                        Log in
                    </Link>
                </div>
            </main>
        );
    }

    const isAdmin = await isAdminDiscordId(session.discordId);
    return <SupportClient isAdmin={isAdmin} />;
}
