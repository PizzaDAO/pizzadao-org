// app/admin/payments/page.tsx
//
// Payment-request queue (plans/host-fast-track.md). Reviewers only (admin roles and Dread Pizza
// Roberts, pinned in code). The API routes enforce the same check on every request. English only:
// like the other admin screens, it is an internal tool.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { paymentActor } from "@/app/lib/payments/access";
import { PaymentsQueue } from "./PaymentsQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Payment requests",
    robots: { index: false, follow: false },
};

export default async function AdminPaymentsPage() {
    const session = await getSession();
    const actor = session?.discordId ? await paymentActor(session.discordId) : null;

    if (!actor?.canReview) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Not available</h1>
                    <p className="text-foreground/60">{session ? "This page is for payment reviewers only." : "Log in to continue."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/payments" className="inline-block mt-4 underline">
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
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Payment requests</h1>
                    <p className="m-0 text-foreground/70">
                        The app only sorts, flags and records. Nothing pays out automatically: after approval a person sends the money and records the reference here.
                    </p>
                </header>
                <PaymentsQueue />
            </div>
        </main>
    );
}
