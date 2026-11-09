import { NextRequest, NextResponse } from "next/server";
import { resolvePfpUrlAsync } from "@/app/lib/pfp";

export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ memberId: string }> }
) {
    try {
        const { memberId } = await params;

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // Short cache: the composed URL is content-hashed, but the lookup itself changes on save.
        const cacheHeaders = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };
        return NextResponse.json({ url: await resolvePfpUrlAsync(memberId) }, { headers: cacheHeaders });
    } catch {
        return NextResponse.json({ error: "Failed to get profile picture" }, { status: 500 });
    }
}
