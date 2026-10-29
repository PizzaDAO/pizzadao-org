// app/admin/payments/[id]/page.tsx — one payment request. Reviewers only; the API enforces it again.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { paymentActor } from "@/app/lib/payments/access";
import { PaymentDetail } from "./PaymentDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Payment request",
    robots: { index: false, follow: false },
};

export default async function AdminPaymentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    const actor = session?.discordId ? await paymentActor(session.discordId) : null;

    if (!actor?.canReview) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Not available</h1>
                    <p className="text-foreground/60">{session ? "This page is for payment reviewers only." : "Log in to continue."}</p>
                    {!session && (
                        <Link href={`/login?returnTo=/admin/payments/${encodeURIComponent(id)}`} className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <Link href="/admin/payments" className="underline text-sm">
                    Back to the queue
                </Link>
                <PaymentDetail id={id} />
            </div>
        </main>
    );
}
