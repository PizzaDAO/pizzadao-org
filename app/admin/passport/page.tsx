// app/admin/passport/page.tsx
//
// Pizza Passport partners (plans/pizza-passport.md, phase 1): add a partner, print its table QR,
// release or reject held check-ins. Guild admins only; the API routes enforce the same check.
// Admin-only English labels, like the settings page's per-setting text.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { PassportAdmin } from "./PassportAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pizza Passport admin", robots: { index: false, follow: false } };

export default async function AdminPassportPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Admins only</h1>
                    {!session && (
                        <Link href="/login?returnTo=/admin/passport" className="underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }
    return <PassportAdmin />;
}
