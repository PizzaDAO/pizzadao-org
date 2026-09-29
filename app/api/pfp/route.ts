import { NextRequest, NextResponse } from "next/server";
import { resolvePfpUrls } from "@/app/lib/pfp";

export const runtime = "nodejs";

/** Upper bound on IDs per request (the member directory pages at most 60). */
const MAX_IDS = 200;

/**
 * GET /api/pfp?ids=1,2,3
 * Batch profile-picture lookup: `{ urls: { "1": "/pfp/1.jpg", "2": "/pfp/default.jpg", ... } }`.
 * Same resolution rules as /api/pfp/[memberId].
 */
export async function GET(request: NextRequest) {
    const raw = request.nextUrl.searchParams.get("ids") || "";
    const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (ids.length === 0) {
        return NextResponse.json({ error: "Missing ids" }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
        return NextResponse.json({ error: `Too many ids (max ${MAX_IDS})` }, { status: 400 });
    }

    return NextResponse.json(
        { urls: resolvePfpUrls(ids) },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
}
