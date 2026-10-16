import { activationActor, recordActivationLater as recordActivation } from "@/app/lib/activation";
import { sanitizeSignupDraft } from "@/app/lib/signup-draft";
import { readRefCookie } from "@/app/lib/referral-cookie";
import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { requestMagicLogin } from "@/app/lib/magic-login";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "magic-login");
  if (limited) return limited;

  let actor: string | undefined;
  try {
    const text = await req.text();
    if (text.length > 8192) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const body = JSON.parse(text);
    const draft = sanitizeSignupDraft(body?.signupDraft);
    actor = draft?.sessionId || activationActor(body.actor);
    const ref = readRefCookie(req);
    if (draft && ref && draft.invitedBy === undefined) draft.invitedBy = { memberId: ref, name: "", viaLink: true };
    const username = String(body?.username ?? "").trim();

    if (username.length < 2 || username.length > 32) {
      return NextResponse.json(
        { error: "Username must be 2-32 characters" },
        { status: 400 },
      );
    }

    const origin = new URL(req.url).origin;
    const result = await requestMagicLogin(username, origin, {
      returnTo: body?.returnTo,
      onboarding: body?.onboarding === true,
      signupDraft: draft,
    });

    if (result.status !== "sent") recordActivation("login_failed", { actor, code: result.status });
    switch (result.status) {
      case "sent":
        return NextResponse.json({ status: "sent" });
      case "not_found":
        return NextResponse.json(
          { status: "not_found", error: "Username not found in PizzaDAO Discord" },
          { status: 404 },
        );
      case "dm_failed":
        return NextResponse.json(
          {
            status: "dm_failed",
            error: result.error === "dms_disabled"
              ? "Could not send DM. Please enable DMs from server members in your Discord privacy settings."
              : "Failed to send DM. Please try again.",
          },
          { status: 422 },
        );
      case "rate_limited":
        return NextResponse.json(
          { status: "rate_limited", error: "Too many requests. Try again in a few minutes." },
          { status: 429 },
        );
    }
  } catch (e: unknown) {
    recordActivation("login_failed", { actor, code: "request_error" });
    console.error("Magic login request error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
