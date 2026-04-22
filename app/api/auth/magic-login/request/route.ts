import { NextResponse } from "next/server";
import { requestMagicLogin } from "@/app/lib/magic-login";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? "").trim();

    if (username.length < 2 || username.length > 32) {
      return NextResponse.json(
        { error: "Username must be 2-32 characters" },
        { status: 400 },
      );
    }

    const origin = new URL(req.url).origin;
    const result = await requestMagicLogin(username, origin);

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
    console.error("Magic login request error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
