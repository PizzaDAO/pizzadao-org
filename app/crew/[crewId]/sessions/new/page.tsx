// app/crew/[crewId]/sessions/new/page.tsx
//
// Education crew leads and guild admins: schedule a session (Discord event + announcement + flyer)
// from one form. Plain English (lead tooling). The API enforces the same check.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { canManageCrew } from "@/app/lib/crew-leads";
import { normalizeCrewId } from "@/app/lib/crew-id";
import { EDUCATION_CREW_ID } from "@/app/lib/education-sessions/build";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import SessionForm from "./SessionForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Schedule a session", robots: { index: false, follow: false } };

export default async function NewSessionPage({ params }: { params: Promise<{ crewId: string }> }) {
    const { crewId: raw } = await params;
    const crewId = normalizeCrewId(raw);
    if (crewId !== EDUCATION_CREW_ID) notFound();
    const session = await getSession();
    const allowed = session?.discordId ? await canManageCrew(session.discordId, crewId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center max-w-md">
                    <h1 className="text-2xl mb-3">Crew leads only</h1>
                    <p className="text-foreground/60">
                        {session ? "Only leads of the education crew can schedule sessions." : "Please log in with Discord."}
                    </p>
                    <Link href={session ? `/crew/${crewId}` : `/login?returnTo=/crew/${crewId}/sessions/new`} className="inline-block mt-4 underline">
                        {session ? "Back to the crew page" : "Log in"}
                    </Link>
                </div>
            </main>
        );
    }

    const enabled = await toggleEnabled("education.sessionAnnounceEnabled");
    const isAdmin = await isAdminDiscordId(session!.discordId);
    return (
        <main className="min-h-screen bg-background text-foreground p-5">
            <div className="max-w-2xl mx-auto">
                <Link href={`/crew/${crewId}`} className="underline text-sm">
                    Back to the crew page
                </Link>
                <h1 className="text-2xl mt-3 mb-1">Schedule an education session</h1>
                <p className="text-foreground/60 mb-5">
                    Schedule creates the Discord event (with the flyer as its cover) and posts the announcement with the flyer. Pressing it twice is safe.
                </p>
                <SessionForm enabled={enabled} crewId={crewId} isAdmin={isAdmin} />
            </div>
        </main>
    );
}
