// app/dashboard/page.tsx
//
// Old pizzadao.org link: /dashboard on its own. A signed-in viewer goes to their dashboard, anyone
// else to /login. (The real dashboard is /dashboard/[id]; the old prototype's sub-pages redirect in
// next.config.ts via app/lib/legacy-paths.ts.)
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardIndexPage() {
    const session = await getSession();
    if (!session?.discordId) redirect("/login");
    let memberId: string | null = null;
    try {
        memberId = (await fetchMemberIdByDiscordId(session.discordId)) ?? null;
    } catch {
        // Lookup failed: don't send a member to onboarding; the home page has the nav's Dashboard link.
        redirect("/");
    }
    // Signed in but not a member yet: the onboarding wizard.
    redirect(memberId ? `/dashboard/${encodeURIComponent(String(memberId))}` : "/start");
}
