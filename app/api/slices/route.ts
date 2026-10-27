// GET /api/slices -> { items: SliceItem[] } for the signed-in member (their attended calls + claim status)
import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { listSlices } from "@/app/lib/slices/claims";
import { addressUrl, contractAddress } from "@/app/lib/slices/config";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  try {
    const items = await listSlices(auth.session.discordId);
    const contract = contractAddress();
    return NextResponse.json(
      { items, contractUrl: contract ? addressUrl(contract) : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[slices] GET error:", err);
    return NextResponse.json({ error: "Failed to load slices" }, { status: 500 });
  }
}
