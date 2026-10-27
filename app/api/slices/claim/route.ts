// POST /api/slices/claim { crewId, callDay } | { all: true }
//   -> { claimed, already, hasWallet }
// Gated by session + CallAttendance; one slice per member per call. The mint is
// queued and processed right after the response (cron is the backstop).
import { after, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { recordActivationLater } from "@/app/lib/activation";
import { claimActivationCode, claimSlices } from "@/app/lib/slices/claims";
import { processMintQueueSafe } from "@/app/lib/slices/mint-queue";
import { ensureCallImagesSafe } from "@/app/lib/slices/art";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const discordId = auth.session.discordId;

  const limited = await checkKeyedRateLimit("slices-claim", discordId);
  if (!limited.success) return rateLimitResponse(limited);

  const body = (await req.json().catch(() => null)) as { crewId?: unknown; callDay?: unknown; all?: unknown } | null;
  const all = body?.all === true;
  const crewId = typeof body?.crewId === "string" ? body.crewId : "";
  const callDay = typeof body?.callDay === "string" ? body.callDay : "";

  try {
    const res = await claimSlices(discordId, all ? null : [{ crewId, callDay }]);
    if (!res.ok) {
      return NextResponse.json({ error: res.reason }, { status: res.reason === "invalid" ? 400 : 403 });
    }
    for (const k of res.claimedKeys.slice(0, 25)) {
      recordActivationLater("slice_claimed", { discordId, code: claimActivationCode(k.crewId, k.callDay) });
    }
    if (res.claimed > 0) {
      after(async () => {
        await processMintQueueSafe();
        await ensureCallImagesSafe(res.newCallIds);
      });
    }
    return NextResponse.json({ claimed: res.claimed, already: res.already, hasWallet: res.hasWallet });
  } catch (err) {
    console.error("[slices] POST claim error:", err);
    return NextResponse.json({ error: "Failed to claim slice" }, { status: 500 });
  }
}
