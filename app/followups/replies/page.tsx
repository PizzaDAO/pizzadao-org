// Read-only replies to follow-ups, for members at or above followups.replyMinLevel (and Dread Pizza Roberts).
import type { Metadata } from "next";
import { getSession } from "@/app/lib/session";
import { canReadFollowUpReplies } from "@/app/lib/followups/reply-access";
import { listReplies } from "@/app/lib/followups/replies-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-up replies", robots: { index: false, follow: false } };

export default async function FollowUpRepliesPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await canReadFollowUpReplies(session.discordId) : false;
    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <p className="text-foreground/60">{session ? "You do not have access to this page." : "Log in to continue."}</p>
            </main>
        );
    }
    const items = await listReplies();
    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-3xl grid gap-4">
                <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Follow-up replies</h1>
                {items.length === 0 && <p className="text-foreground/60">No replies yet.</p>}
                {items.map((i) => (
                    <article key={i.id} className="grid gap-1 rounded-xl border p-4">
                        <p className="m-0 text-sm text-foreground/60">
                            <strong className="text-foreground">{i.ownerName}</strong>
                            {i.crew ? ` · ${i.crew}` : ""}
                            {i.callTitle ? ` · ${i.callTitle}` : ""}
                            {i.channel ? <span className="ml-1 rounded border px-1 text-xs">{i.channel === "TELEGRAM" ? "Telegram DM" : "Discord DM"}</span> : null}
                            {` · ${new Date(i.repliedAt).toLocaleString()}`}
                        </p>
                        <p className="m-0 whitespace-pre-wrap">{i.reply}</p>
                    </article>
                ))}
            </div>
        </main>
    );
}
