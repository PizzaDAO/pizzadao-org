// app/crew/[crewId]/sessions/[sessionId]/edit/page.tsx
//
// Leads and guild admins: edit a scheduled session in place (the Discord event and posts are updated,
// never recreated). Plain English (lead tooling). The API enforces the same checks.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { normalizeCrewId } from "@/app/lib/crew-id";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { isSessionCrew, sessionManagerOrNull } from "@/app/lib/education-sessions/access";
import { SESSION_STATUS, wallParts } from "@/app/lib/education-sessions/build";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import SessionForm from "../../SessionForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit a session", robots: { index: false, follow: false } };

export default async function EditSessionPage({ params }: { params: Promise<{ crewId: string; sessionId: string }> }) {
    const { crewId: raw, sessionId } = await params;
    const crewId = normalizeCrewId(raw);
    if (!(await isSessionCrew(crewId))) notFound();
    const session = await getSession();
    if (!(await sessionManagerOrNull(crewId))) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center max-w-md">
                    <h1 className="text-2xl mb-3">Crew leads only</h1>
                    <p className="text-foreground/60">{session ? "Only leads of this crew can edit sessions." : "Please log in with Discord."}</p>
                    <Link href={session ? `/crew/${crewId}` : `/login?returnTo=/crew/${crewId}/sessions`} className="inline-block mt-4 underline">
                        {session ? "Back to the crew page" : "Log in"}
                    </Link>
                </div>
            </main>
        );
    }
    const row = await prisma.crewSession.findUnique({ where: { id: sessionId } });
    if (!row || row.crewId !== crewId) notFound();

    const editable = row.status !== SESSION_STATUS.CANCELED && row.endsAt.getTime() >= Date.now();
    const [announceOn, editOn, listingEnabled, isAdmin] = await Promise.all([
        toggleEnabled("education.sessionAnnounceEnabled"),
        toggleEnabled("education.editEnabled"),
        toggleEnabled("education.publicListingEnabled"),
        isAdminDiscordId(session!.discordId),
    ]);
    const { date, time } = wallParts(row.startsAt, row.timeZone);
    return (
        <main className="min-h-screen bg-background text-foreground p-5">
            <div className="max-w-5xl mx-auto">
                <Link href={`/crew/${crewId}/sessions`} className="underline text-sm">
                    Back to sessions
                </Link>
                <h1 className="text-2xl mt-3 mb-1">Edit a session</h1>
                <p className="text-foreground/60 mb-5">Saving updates the existing Discord event and announcement. Nothing new is posted.</p>
                {!editable ? (
                    <p className="rounded border border-foreground/20 p-3 text-sm">{row.status === SESSION_STATUS.CANCELED ? "This session was canceled and can no longer be edited." : "This session already ended and can no longer be edited."}</p>
                ) : (
                    <SessionForm
                        mode="edit"
                        sessionId={row.id}
                        enabled={announceOn && editOn}
                        crewId={crewId}
                        isAdmin={isAdmin}
                        listingEnabled={listingEnabled}
                        initial={{
                            title: row.title,
                            presenter: row.presenter ?? "",
                            description: row.description,
                            date,
                            time,
                            timeZone: row.timeZone,
                            lengthMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
                            public: row.public,
                            recordingUrl: row.recordingUrl ?? "",
                        }}
                    />
                )}
            </div>
        </main>
    );
}
