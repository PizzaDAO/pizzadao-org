// GET  /api/poap-claims          -> { items: PoapClaimItem[] } for the signed-in member
// POST /api/poap-claims { crewId, callDay } -> { link, alreadyClaimed } (one per member per call)
import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { claimActivationCode, claimPoap, listPoapClaims } from "@/app/lib/poap-claims";
import { recordActivationLater } from "@/app/lib/activation";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  try {
    const items = await listPoapClaims(auth.session.discordId);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[poap-claims] GET error:", err);
    return NextResponse.json({ error: "Failed to load POAP claims" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { crewId?: unknown; callDay?: unknown } | null;
  const crewId = typeof body?.crewId === "string" ? body.crewId : "";
  const callDay = typeof body?.callDay === "string" ? body.callDay : "";
  try {
    const res = await claimPoap(auth.session.discordId, crewId, callDay);
    if (!res.ok) {
      const status = res.reason === "invalid" ? 400 : res.reason === "not_attended" ? 403 : 409;
      return NextResponse.json({ error: res.reason }, { status });
    }
    if (!res.alreadyClaimed) {
      recordActivationLater("poap_claimed", { discordId: auth.session.discordId, code: claimActivationCode(crewId, callDay) });
    }
    return NextResponse.json({ link: res.link, alreadyClaimed: res.alreadyClaimed });
  } catch (err) {
    console.error("[poap-claims] POST error:", err);
    return NextResponse.json({ error: "Failed to claim POAP" }, { status: 500 });
  }
}
