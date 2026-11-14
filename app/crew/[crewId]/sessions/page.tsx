// app/crew/[crewId]/sessions/page.tsx
//
// The manage page for leads and guild admins: upcoming and past sessions with the state of each step
// (event, announcement, general post, Telegram) and the actions: edit, cancel, retry, copy link.
// Plain English (lead tooling). The API routes enforce the same checks.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { normalizeCrewId } from "@/app/lib/crew-id";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { isSessionCrew, sessionManagerOrNull } from "@/app/lib/education-sessions/access";
import { formatWhen, SESSION_STATUS } from "@/app/lib/education-sessions/build";
import { savedChannelId } from "@/app/lib/settings/channels";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { SITE_URL } from "@/app/lib/site-url";
import SessionActions from "./SessionActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sessions", robots: { index: false, follow: false } };

type Chip = { label: string; state: "ok" | "missing" | "stuck" | "off" };
const chipText: Record<Chip["state"], string> = { ok: "done", missing: "not posted", stuck: "unclear, ask an admin", off: "off" };

export default async function SessionsManagePage({ params }: { params: Promise<{ crewId: string }> }) {
    const { crewId: raw } = await params;
    const crewId = normalizeCrewId(raw);
    if (!(await isSessionCrew(crewId))) notFound();
    const session = await getSession();
    if (!(await sessionManagerOrNull(crewId))) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center max-w-md">
                    <h1 className="text-2xl mb-3">Crew leads only</h1>
                    <p className="text-foreground/60">{session ? "Only leads of this crew can manage sessions." : "Please log in with Discord."}</p>
                    <Link href={session ? `/crew/${crewId}` : `/login?returnTo=/crew/${crewId}/sessions`} className="inline-block mt-4 underline">
                        {session ? "Back to the crew page" : "Log in"}
                    </Link>
                </div>
            </main>
        );
    }

    const [rows, announceOn, editOn, listingOn, isAdmin, eventCh, announceCh, generalCh] = await Promise.all([
        prisma.crewSession.findMany({ where: { crewId }, orderBy: { startsAt: "desc" }, take: 100 }),
        toggleEnabled("education.sessionAnnounceEnabled"),
        toggleEnabled("education.editEnabled"),
        toggleEnabled("education.publicListingEnabled"),
        isAdminDiscordId(session!.discordId),
        savedChannelId("discord.educationEventChannelId"),
        savedChannelId("discord.educationChannelId"),
        savedChannelId("discord.educationGeneralChannelId"),
    ]);
    const now = Date.now();
    const upcoming = rows.filter((r) => r.endsAt.getTime() >= now).reverse();
    const past = rows.filter((r) => r.endsAt.getTime() < now);
    const step = (id: string | null, configured: boolean): Chip["state"] => (!configured ? "off" : !id ? "missing" : id === "PENDING" ? "stuck" : "ok");

    const list = (title: string, items: typeof rows) => (
        <section className="mt-6">
            <h2 className="text-lg mb-2">{title}</h2>
            {items.length === 0 ? (
                <p className="text-sm text-foreground/60">None.</p>
            ) : (
                <ul className="space-y-3">
                    {items.map((r) => {
                        const canceled = r.status === SESSION_STATUS.CANCELED;
                        const ended = r.endsAt.getTime() < now;
                        const chips: Chip[] = [
                            { label: "Event", state: step(r.eventId, !!eventCh) },
                            { label: "Announcement", state: step(r.announceMessageId, !!announceCh) },
                            { label: "General post", state: step(r.generalMessageId, !!generalCh && generalCh !== announceCh) },
                            { label: "Telegram", state: r.telegramQueued ? "ok" : "off" },
                        ];
                        const hasMissing = chips.slice(0, 3).some((c) => c.state === "missing");
                        const hasStuck = chips.some((c) => c.state === "stuck");
                        return (
                            <li key={r.id} className="rounded border border-foreground/20 p-3 space-y-2">
                                <div className="flex flex-wrap items-baseline gap-x-3">
                                    <span className="font-medium">{r.title}</span>
                                    {canceled && <span className="text-sm rounded border border-foreground/30 px-2">Canceled</span>}
                                    {!r.public && <span className="text-sm text-foreground/60">Hidden from the public page</span>}
                                </div>
                                <p className="text-sm text-foreground/70">
                                    {formatWhen(r)}
                                    {r.presenter ? ` · ${r.presenter}` : ""}
                                </p>
                                {!canceled && (
                                    <p className="text-xs text-foreground/70">
                                        {chips.map((c) => `${c.label}: ${chipText[c.state]}`).join(" · ")}
                                    </p>
                                )}
                                {r.lastError && <p className="text-xs text-red-600">{r.lastError}</p>}
                                <SessionActions
                                    crewId={crewId}
                                    sessionId={r.id}
                                    editEnabled={editOn && announceOn}
                                    canceled={canceled}
                                    ended={ended}
                                    hasMissing={hasMissing}
                                    hasStuck={hasStuck}
                                    isAdmin={isAdmin}
                                    publicLink={listingOn && r.public && !canceled ? `${SITE_URL}/learn#${r.id}` : null}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );

    return (
        <main className="min-h-screen bg-background text-foreground p-5">
            <div className="max-w-3xl mx-auto">
                <Link href={`/crew/${crewId}`} className="underline text-sm">
                    Back to the crew page
                </Link>
                <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                    <h1 className="text-2xl">Sessions</h1>
                    <Link href={`/crew/${crewId}/sessions/new`} className="rounded px-4 py-2 bg-foreground text-background no-underline">
                        Schedule a session
                    </Link>
                </div>
                {!announceOn && <p className="mt-4 rounded border border-foreground/20 p-3 text-sm">Posting is switched off by an admin, so nothing below can be changed yet.</p>}
                {announceOn && !editOn && <p className="mt-4 rounded border border-foreground/20 p-3 text-sm">Editing and canceling are switched off by an admin. You can still schedule new sessions.</p>}
                {list("Upcoming", upcoming)}
                {list("Past", past)}
            </div>
        </main>
    );
}
