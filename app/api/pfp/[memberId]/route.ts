import { NextRequest, NextResponse } from "next/server";
import { resolvePfpUrl } from "@/app/lib/pfp";

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

        const cacheHeaders = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };
        return NextResponse.json({ url: resolvePfpUrl(memberId) }, { headers: cacheHeaders });
    } catch {
        return NextResponse.json({ error: "Failed to get profile picture" }, { status: 500 });
    }
}
