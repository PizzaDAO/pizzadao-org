// app/admin/calls/attendance/page.tsx
//
// Attendance compare report (sheet versus recordings, per crew and day) and the admin add/remove fix-up.
// Dread Pizza Roberts only, the same check as call review. The API route enforces it too.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { canReviewCalls } from "@/app/lib/calls/access";
import { buildCompareReport, recentAttendanceEdits } from "@/app/lib/calls/attendance-compare";
import AttendanceCompare from "./AttendanceCompare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Call attendance", robots: { index: false, follow: false } };

export default async function AdminCallAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const session = await getSession();
    const allowed = session?.discordId ? await canReviewCalls(session.discordId) : false;
    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access denied</h1>
                    <p className="text-foreground/60">{session ? "Only Dread Pizza Roberts can open this page." : "Log in to continue."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/calls/attendance" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const sp = await searchParams;
    const raw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
    const days = Math.min(120, Math.max(1, Number(raw) || 30));
    const [report, edits] = await Promise.all([buildCompareReport({ days }), recentAttendanceEdits(50)]);

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-5xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">
                        <Link href="/admin/calls" className="no-underline">
                            Calls
                        </Link>
                    </p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Call attendance</h1>
                    <p className="m-0 text-foreground/70">
                        Who the daily sheets counted versus who the recordings counted, per crew and day. Recording attendance applies the minimum minutes
                        in Settings. Sheet-only people are the ones the recordings missed; close to none over two weeks means the sheets can be switched off.
                    </p>
                    <nav className="flex gap-4 text-sm">
                        {[7, 14, 30, 60, 120].map((d) => (
                            <Link key={d} href={`/admin/calls/attendance?days=${d}`} aria-current={d === days ? "page" : undefined} className={d === days ? "font-bold underline" : "underline text-foreground/70"}>
                                {d} days
                            </Link>
                        ))}
                    </nav>
                </header>
                <AttendanceCompare
                    report={report}
                    edits={edits.map((e) => ({
                        id: e.id,
                        action: e.action,
                        discordId: e.discordId,
                        crewId: e.crewId,
                        date: e.callDate.toISOString().slice(0, 10),
                        actorId: e.actorId,
                        reason: e.reason,
                        source: e.source,
                        at: e.createdAt.toISOString(),
                    }))}
                />
            </div>
        </main>
    );
}
