// app/admin/email-preview/page.tsx
//
// Admin preview of the weekly re-engagement email for any member id. Renders
// exactly what /api/cron/reengage would send (subject, HTML, plain text), in
// the member's locale or a chosen one. Sends nothing, writes nothing, and never
// shows the member's address. Server-side admin gate.
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { loadDigests, parseCrewNames } from "@/app/lib/reengage/digest";
import { renderDigestEmail } from "@/app/lib/reengage/render";
import { reengageEnabled } from "@/app/lib/reengage/run";
import { postalAddress } from "@/app/lib/reengage/mailer";
import { SITE_URL } from "@/app/lib/site-url";
import { isSupportedLocale, SUPPORTED_LOCALES } from "@/app/lib/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Admin · Email preview",
    robots: { index: false, follow: false },
};

export default async function AdminEmailPreviewPage({
    searchParams,
}: {
    searchParams: Promise<{ member?: string; locale?: string }>;
}) {
    const session = await getSession();
    const isAdmin = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
    if (!isAdmin) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Access Denied</h1>
                    <p className="text-foreground/60">
                        {session ? "This page is restricted to admins." : "Please log in with Discord."}
                    </p>
                    <Link href="/" className="inline-block mt-4 underline">
                        ← Home
                    </Link>
                </div>
            </main>
        );
    }

    const { member, locale } = await searchParams;
    const memberId = (member ?? "").trim();
    let notFound = false;
    let rendered: ReturnType<typeof renderDigestEmail> | null = null;
    let hasContent = true;

    if (memberId) {
        const row = await fetchMemberById(memberId).catch(() => null);
        if (!row) {
            notFound = true;
        } else {
            const [digest] = await loadDigests([
                {
                    memberId,
                    discordId: String(row.discordId ?? "").trim(),
                    name: String(row["Name"] || row["Mafia Name"] || "").trim(),
                    crewNames: parseCrewNames(row["Crews"]),
                },
            ]);
            const d = isSupportedLocale(locale) ? { ...digest, locale } : digest;
            hasContent = d.hasContent;
            rendered = renderDigestEmail(d, { siteUrl: SITE_URL, unsubscribeUrl: "#", postalAddress: postalAddress() });
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-5 max-w-3xl mx-auto grid gap-4">
            <h1 className="text-2xl font-black m-0">Weekly email preview</h1>
            <p className="m-0 text-foreground/60">
                Sending is {reengageEnabled() ? "ENABLED" : "off"} (REENGAGE_EMAIL_ENABLED). This page never sends.
            </p>
            <form method="get" className="flex flex-wrap gap-2 items-end">
                <label className="grid gap-1 text-sm">
                    Member ID
                    <input name="member" defaultValue={memberId} className="border rounded px-2 py-1" />
                </label>
                <label className="grid gap-1 text-sm">
                    Locale
                    <select name="locale" defaultValue={locale ?? ""} className="border rounded px-2 py-1">
                        <option value="">Member&apos;s own</option>
                        {SUPPORTED_LOCALES.map((l) => (
                            <option key={l} value={l}>{l}</option>
                        ))}
                    </select>
                </label>
                <button type="submit" className="btn-pill" style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}>
                    Preview
                </button>
            </form>

            {notFound ? <p className="m-0">No member with that ID.</p> : null}
            {rendered ? (
                <section className="grid gap-3">
                    {!hasContent ? (
                        <p className="m-0 text-foreground/60">
                            This member would be skipped (nothing to say this week); the preview shows the empty digest.
                        </p>
                    ) : null}
                    <p className="m-0"><strong>Subject:</strong> {rendered.subject}</p>
                    <iframe
                        title="Email preview"
                        sandbox=""
                        srcDoc={rendered.html}
                        className="w-full border rounded"
                        style={{ height: 640, background: "#fff" }}
                    />
                    <details>
                        <summary>Plain text version</summary>
                        <pre className="whitespace-pre-wrap text-sm">{rendered.text}</pre>
                    </details>
                </section>
            ) : null}
        </main>
    );
}
