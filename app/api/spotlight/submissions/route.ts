// app/api/spotlight/submissions/route.ts
//
// Mafia Spotlight submissions (blackolive-55617).
//   GET  -> the caller's submissions, newest first (admin notes omitted)
//   POST -> creates a submission and pings Discord (best-effort)

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireSession } from "@/app/lib/auth-guards";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import {
    MAX_PENDING,
    MAX_SUBMISSIONS_PER_DAY,
    NAME_MAX_LEN,
    notifyNewSubmission,
    parseSubmissionInput,
    toMemberSubmission,
} from "@/app/lib/spotlight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    const submissions = await prisma.spotlightSubmission.findMany({
        where: { submitterDiscordId: auth.session.discordId },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    return NextResponse.json({ submissions: submissions.map(toMemberSubmission) }, { headers: NO_STORE });
}

export async function POST(req: Request) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { session } = auth;

    const parsed = parseSubmissionInput(await req.json().catch(() => null));
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent, pending] = await Promise.all([
        prisma.spotlightSubmission.count({
            where: { submitterDiscordId: session.discordId, createdAt: { gte: since } },
        }),
        prisma.spotlightSubmission.count({
            where: { submitterDiscordId: session.discordId, status: { in: ["NEW", "SHORTLISTED"] } },
        }),
    ]);
    if (recent >= MAX_SUBMISSIONS_PER_DAY) {
        return NextResponse.json(
            { error: `You can submit at most ${MAX_SUBMISSIONS_PER_DAY} spotlights per day. Please try again later.` },
            { status: 429 },
        );
    }
    if (pending >= MAX_PENDING) {
        return NextResponse.json(
            { error: `You already have ${MAX_PENDING} submissions waiting for review. Please wait for those to be handled.` },
            { status: 429 },
        );
    }

    let memberId: string | null = null;
    try {
        memberId = await fetchMemberIdByDiscordId(session.discordId);
    } catch {
        // Best-effort.
    }
    const submitterName = (session.nick || session.username || "").slice(0, NAME_MAX_LEN) || null;
    const v = parsed.value;

    const submission = await prisma.spotlightSubmission.create({
        data: {
            submitterDiscordId: session.discordId,
            submitterMemberId: memberId,
            submitterName,
            isSelf: v.isSelf,
            nomineeName: v.isSelf ? submitterName || "Unknown" : (v.nomineeName as string),
            nomineeDiscord: v.isSelf ? null : v.nomineeDiscord,
            nomineeDiscordId: v.isSelf ? session.discordId : null,
            nomineeMemberId: v.isSelf ? memberId : null,
            city: v.city,
            pitch: v.pitch,
            links: v.links,
            photoUrl: v.photoUrl,
            consent: v.consent,
        },
    });

    // Never fail the request on a webhook problem.
    await notifyNewSubmission(submission);

    return NextResponse.json({ ok: true, submission: toMemberSubmission(submission) }, { status: 201 });
}
