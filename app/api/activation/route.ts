import { NextResponse } from "next/server";
import { activationActor, recordActivation } from "@/app/lib/activation";
import { enforceRateLimit } from "@/app/lib/rate-limit";

export async function POST(req: Request) {
  if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin) return new NextResponse(null, { status: 403 });
  const limited = await enforceRateLimit(req, "activation");
  if (limited) return limited;
  try {
    const text = await req.text();
    if (text.length > 512) return new NextResponse(null, { status: 413 });
    const { event, actor, code } = JSON.parse(text);
    if (!activationActor(actor) || !["signup_started", "client_error"].includes(event)) return new NextResponse(null, { status: 400 });
    if (event === "client_error" && !["login_network", "profile_network", "draft_restore"].includes(code)) return new NextResponse(null, { status: 400 });
    await recordActivation(event, { actor, code: event === "client_error" ? code : undefined });
    return new NextResponse(null, { status: 204 });
  } catch { return new NextResponse(null, { status: 400 }); }
}
