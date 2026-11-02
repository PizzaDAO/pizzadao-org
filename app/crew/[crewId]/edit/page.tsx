// app/crew/[crewId]/edit/page.tsx
//
// Crew-lead editor for a crew's tasks, meeting agenda and goals, once they live on the website
// (plans/sheets-cutover.md PR 4). Leads of the crew and guild admins only; the API enforces the
// same check. Plain English (lead tooling, not translated yet).

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { canManageCrew } from "@/app/lib/crew-leads";
import { normalizeCrewId } from "@/app/lib/crew-id";
import { usesDb } from "@/app/lib/sheets-import/source";
import TableEditorClient from "@/app/admin/sheets/edit/[dataset]/TableEditorClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit crew", robots: { index: false, follow: false } };

export default async function EditCrewPage({ params }: { params: Promise<{ crewId: string }> }) {
    const { crewId: raw } = await params;
    const crewId = normalizeCrewId(raw);
    const session = await getSession();
    const allowed = session?.discordId ? await canManageCrew(session.discordId, crewId) : false;
    const [tasksOnWebsite, rosterOnWebsite] = await Promise.all([usesDb("crewTasks", crewId), usesDb("crewRoles", crewId)]);
    const onWebsite = tasksOnWebsite || rosterOnWebsite;

    if (!allowed || !onWebsite) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center max-w-md">
                    <h1 className="text-2xl mb-3">{!allowed ? "Crew leads only" : "Not on the website yet"}</h1>
                    <p className="text-foreground/60">
                        {!session
                            ? "Please log in with Discord."
                            : !allowed
                              ? "Only leads of this crew can edit its tasks and agenda."
                              : "This crew's tasks, agenda and roster are still edited in its Google Sheet."}
                    </p>
                    <Link href={session ? `/crew/${crewId}` : `/login?returnTo=/crew/${crewId}/edit`} className="inline-block mt-4 underline">
                        {session ? "Back to the crew page" : "Log in"}
                    </Link>
                </div>
            </main>
        );
    }

    const back = { backHref: `/crew/${crewId}`, backLabel: "Back to the crew page" };
    return (
        <div>
            {tasksOnWebsite && (
                <>
                    <TableEditorClient dataset={`crewTasks:${crewId}`} apiUrl={`/api/crew/${crewId}/content/tasks`} {...back} />
                    <TableEditorClient dataset={`crewAgenda:${crewId}`} apiUrl={`/api/crew/${crewId}/content/agenda`} {...back} />
                    <TableEditorClient dataset={`crewGoals:${crewId}`} apiUrl={`/api/crew/${crewId}/content/goals`} {...back} />
                </>
            )}
            {rosterOnWebsite && <TableEditorClient dataset={`crewRoster:${crewId}`} apiUrl={`/api/crew/${crewId}/content/roster`} {...back} />}
        </div>
    );
}
